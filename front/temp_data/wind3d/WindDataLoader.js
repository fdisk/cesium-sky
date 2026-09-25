/**
 * Phase 2 - 3D Wind Data Loader
 *
 * - load(jsonUrl, binUrl)          : legacy single-frame 로딩 (Float32 .bin)
 * - loadBundle(bundleUrl)          : timelapse 단일 번들 파일(.bin.gz) 로딩
 *                                    (1라인 JSON 헤더 + '\n' + 프레임별 gzip 멤버 N개)
 * - loadFrame(frameIndex)          : 멤버 영역 슬라이스 → gzip 복원 → uint16 → Float32Array
 * - FramePool                      : LRU 캐시(기본 5개) + 인접 프레임 프리페치
 */

// ============================================================
// gzip 복원 (DecompressionStream 우선, 미지원 브라우저는 pako CDN 폴백)
// ============================================================
let _pakoPromise = null;

function loadPako() {
    if (typeof window !== 'undefined' && window.pako) return Promise.resolve(window.pako);
    if (_pakoPromise) return _pakoPromise;
    _pakoPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/pako.js';
        s.onload = () => resolve(window.pako);
        s.onerror = () => reject(new Error('pako CDN 로드 실패'));
        document.head.appendChild(s);
    });
    return _pakoPromise;
}

async function decompressGzip(buffer) {
    if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip');
        const stream = new Response(buffer).body.pipeThrough(ds);
        return await new Response(stream).arrayBuffer();
    }
    // 폴백: pako (UMD) — 구형 브라우저용
    const pako = await loadPako();
    return pako.ungzip(new Uint8Array(buffer)).buffer;
}

// ============================================================
// BundleCache — 번들 파일 브라우저 캐시
//   1차: Cache API (secure context: https / localhost)
//   폴백: IndexedDB (http 사내망 등 non-secure context)
//   둘 다 불가: passthrough (캐시 없이 동작)
// ============================================================
export class BundleCache {
    constructor() {
        this.mode = 'none';   // 'cache-api' | 'indexeddb' | 'none'
        this._cache = null;   // Cache API 인스턴스
        this._db = null;      // IndexedDB 인스턴스
        this._ready = null;
    }

    async _init() {
        if (this._ready) return this._ready;
        this._ready = (async () => {
            if (typeof window !== 'undefined' && window.caches) {
                try {
                    this._cache = await caches.open('wind-bundle-v1');
                    this.mode = 'cache-api';
                    return;
                } catch (e) {
                    console.warn('Cache API 초기화 실패:', e);
                }
            }
            if (typeof indexedDB !== 'undefined') {
                try {
                    this._db = await new Promise((resolve, reject) => {
                        const req = indexedDB.open('wind-bundle-cache', 1);
                        req.onupgradeneeded = () => {
                            const db = req.result;
                            if (!db.objectStoreNames.contains('meta')) {
                                db.createObjectStore('meta', { keyPath: 'url' });
                            }
                            if (!db.objectStoreNames.contains('buffers')) {
                                db.createObjectStore('buffers', { keyPath: 'url' });
                            }
                        };
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => reject(req.error);
                    });
                    this.mode = 'indexeddb';
                    return;
                } catch (e) {
                    console.warn('IndexedDB 초기화 실패:', e);
                }
            }
            this.mode = 'none';
        })();
        return this._ready;
    }

    _idbGet(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    _idbPut(storeName, value) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    _idbDelete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    _idbClear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    /**
     * 캐시된 번들 Response 반환 (없으면 null)
     */
    async get(url) {
        await this._init();
        if (this.mode === 'cache-api') {
            const res = await this._cache.match(url);
            return res || null;
        }
        if (this.mode === 'indexeddb') {
            const rec = await this._idbGet('buffers', url);
            return rec ? new Response(rec.buffer) : null;
        }
        return null;
    }

    /**
     * Response를 캐시에 저장. 쿼터 초과 등 실패 시 false (graceful degradation)
     */
    async put(url, response) {
        await this._init();
        if (this.mode === 'cache-api') {
            try {
                await this._cache.put(url, response.clone());
                return true;
            } catch (e) {
                console.warn('캐시 저장 실패 (quota 초과 가능):', e);
                return false;
            }
        }
        if (this.mode === 'indexeddb') {
            try {
                const buf = await response.arrayBuffer();
                await this._idbPut('buffers', { url, buffer: buf });
                await this._idbPut('meta', { url, size: buf.byteLength, storedAt: Date.now() });
                return true;
            } catch (e) {
                console.warn('캐시 저장 실패 (quota 초과 가능):', e);
                return false;
            }
        }
        return false;
    }

    /**
     * 특정 URL 캐시 삭제
     */
    async delete(url) {
        await this._init();
        if (this.mode === 'cache-api') {
            await this._cache.delete(url);
            return;
        }
        if (this.mode === 'indexeddb') {
            await this._idbDelete('buffers', url);
            await this._idbDelete('meta', url);
        }
    }

    /**
     * 캐시 전체 삭제
     */
    async clear() {
        await this._init();
        if (this.mode === 'cache-api') {
            await caches.delete('wind-bundle-v1');
            this._cache = await caches.open('wind-bundle-v1');
            return;
        }
        if (this.mode === 'indexeddb') {
            await this._idbClear('buffers');
            await this._idbClear('meta');
        }
    }

    /**
     * 캐시 상태 조회: { cached: boolean, size: number }
     */
    async status(url) {
        await this._init();
        if (this.mode === 'cache-api') {
            const res = await this._cache.match(url);
            return { cached: !!res, size: res ? await this._cacheEntrySize(res) : 0 };
        }
        if (this.mode === 'indexeddb') {
            const meta = await this._idbGet('meta', url);
            return { cached: !!meta, size: meta ? meta.size : 0 };
        }
        return { cached: false, size: 0 };
    }

    /**
     * 캐시된 모든 번들의 총 크기(바이트) + 개수: { totalSize, count }
     */
    /**
     * 캐시된 Response의 바이트 수.
     * 합성 Response(new Response(bytes))는 .size가 항상 0이므로,
     * 저장 시 붙인 X-Bundle-Size 헤더를 우선 사용하고,
     * 헤더가 없는 구버전 캐시는 바디를 읽어 크기를 계산한다.
     */
    async _cacheEntrySize(res) {
        const h = res.headers.get('X-Bundle-Size');
        if (h) {
            const n = parseInt(h, 10);
            if (Number.isFinite(n) && n > 0) return n;
        }
        if (res.size > 0) return res.size;
        const buf = await res.arrayBuffer();
        return buf.byteLength;
    }

    async totalSize() {
        await this._init();
        if (this.mode === 'cache-api') {
            let total = 0, count = 0;
            const keys = await this._cache.keys();
            for (const req of keys) {
                const res = await this._cache.match(req);
                if (res) { total += await this._cacheEntrySize(res); count++; }
            }
            return { totalSize: total, count };
        }
        if (this.mode === 'indexeddb') {
            return new Promise((resolve, reject) => {
                let total = 0, count = 0;
                const tx = this._db.transaction('meta', 'readonly');
                const req = tx.objectStore('meta').openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (cursor) {
                        total += cursor.value.size || 0;
                        count++;
                        cursor.continue();
                    } else {
                        resolve({ totalSize: total, count });
                    }
                };
                req.onerror = () => reject(req.error);
            });
        }
        return { totalSize: 0, count: 0 };
    }

    /**
     * 스토리지 용량/쿼터 조회 (지원 브라우저만): { usage, quota } | null
     */
    async estimate() {
        if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
            return await navigator.storage.estimate();
        }
        return null;
    }
}

// 모듈 레벨 싱글턴 — 모든 WindDataLoader 인스턴스가 공유
export const bundleCache = new BundleCache();

/**
 * fetch-or-cache: 캐시 히트 시 Response 재사용, 미스 시 네트워크 다운로드 후 캐시 저장
 * @param {string} url
 * @param {function} [onProgress]  (pct) => void — 다운로드 진행률 (캐시 히트 시 즉시 100)
 * @param {BundleCache} [cache]
 * @returns {Promise<{bytes:Uint8Array, fromCache:boolean}>}
 */
async function fetchOrCache(url, onProgress, cache) {
    if (cache) {
        const hit = await cache.get(url);
        if (hit) {
            if (onProgress) onProgress(100);
            return { bytes: new Uint8Array(await hit.arrayBuffer()), fromCache: true };
        }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`번들 파일 로드 실패: ${res.status} ${url}`);
    let bytes;
    const total = parseInt(res.headers.get('Content-Length'), 10);
    if (res.body && Number.isFinite(total) && total > 0 && onProgress) {
        // 스트리밍 다운로드: Content-Length 기준 progress % 콜백
        const reader = res.body.getReader();
        const chunks = [];
        let loaded = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.byteLength;
            onProgress(Math.min(100, Math.floor((loaded / total) * 100)));
        }
        bytes = new Uint8Array(loaded);
        let offset = 0;
        for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
    } else {
        bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (cache) {
        // 합성 Response는 .size=0이므로 크기를 헤더로 함께 저장
        cache.put(url, new Response(bytes, { headers: { 'X-Bundle-Size': String(bytes.length) } }))
            .catch(e => console.warn('캐시 저장 실패:', e));
    }
    return { bytes, fromCache: false };
}

// ============================================================
// WindDataLoader
// ============================================================
export class WindDataLoader {
    constructor() {
        this.metadata = null;
        this.windDataArray = null; // Float32Array [U, V, W, GPH, U, V, W, GPH, ...]

        // timelapse 번들 상태
        this.bundle = null;        // 번들 헤더 JSON 객체
        this.bundleUrl = null;
        this.memberRegion = null;  // Uint8Array — 헤더+'\n' 이후의 gzip 멤버 영역
        this.frames = [];          // bundle.frames (ft, validTime, gzOffset, gzSize, scale, gphByLevel)
        this.cacheStatus = { fromCache: false }; // loadBundle() 결과: 브라우저 캐시 히트 여부
    }

    async load(jsonUrl, binUrl) {
        console.log("--> 메타데이터 로딩 중...", jsonUrl);
        const metaRes = await fetch(jsonUrl);
        const metaJson = await metaRes.json();
        this.metadata = metaJson.metadata;

        console.log("--> 3D 바이너리 데이터 로딩 중...", binUrl);
        const binRes = await fetch(binUrl);
        const buffer = await binRes.arrayBuffer();
        this.windDataArray = new Float32Array(buffer);

        console.log(`--> 3D 데이터 로드 완료! (총 ${this.windDataArray.length / 4} 개 그리드 포인트)`);
        return {
            metadata: this.metadata,
            windDataArray: this.windDataArray
        };
    }

    /**
     * timelapse 단일 번들 파일 로딩
     * 파일 구조: 1라인 JSON 헤더 + '\n'(0x0A) + 프레임별 gzip 멤버 N개 (multi-member gzip)
     * @param {string} bundleUrl  wind_bundle_<model>_<initTime>.bin.gz URL
     * @returns {object} bundle 객체 (model, initTime, iCount, jCount, levelCount, bounds, plev, frames[])
     */
    async loadBundle(bundleUrl, onProgress) {
        console.log("--> 번들 파일 로딩 중...", bundleUrl);
        // 브라우저 캐시(Cache API / IndexedDB 폴백) 재사용: 히트 시 네트워크 다운로드 생략
        const { bytes, fromCache } = await fetchOrCache(bundleUrl, onProgress, bundleCache);
        this.cacheStatus = { fromCache, size: bytes.length }; // size: 로드한 번들 파일 바이트 수
        if (fromCache) {
            console.log(`--> 번들 캐시 히트 (브라우저 스토리지 재사용): ${bundleUrl}`);
        }

        // 헤더/멤버 경계: 첫 '\n'(0x0A) 위치 (헤더는 1라인 JSON)
        let nl = -1;
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0x0A) { nl = i; break; }
        }
        if (nl < 0) throw new Error(`번들 파일에 헤더/멤버 경계('\\n') 없음: ${bundleUrl}`);

        const headerText = new TextDecoder('utf-8').decode(bytes.subarray(0, nl));
        this.bundle = JSON.parse(headerText);
        this.bundleUrl = bundleUrl;
        this.memberRegion = bytes.subarray(nl + 1);
        this.frames = this.bundle.frames || [];
        console.log(`--> 번들 로드 완료! (${this.bundle.model} ${this.bundle.initTime}, ${this.frames.length}프레임, ` +
            `멤버 영역 ${(this.memberRegion.length / 1024 / 1024).toFixed(1)} MB)`);
        return this.bundle;
    }

    /**
     * uint16 인터리브 데이터 → Float32Array 복원 (채널별 min + uint16 * step)
     * @param {Uint16Array} uint16  [u, v, w, gph] × N 포인트
     * @param {object} scale      { u: {min, max, step}, v: {...}, w: {...}, gph: {...} }
     */
    restoreFrame(uint16, scale) {
        const n = uint16.length / 4;
        const out = new Float32Array(n * 4);
        const su = scale.u, sv = scale.v, sw = scale.w, sg = scale.gph;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            out[o]     = su.min + uint16[o]     * su.step;
            out[o + 1] = sv.min + uint16[o + 1] * sv.step;
            out[o + 2] = sw.min + uint16[o + 2] * sw.step;
            out[o + 3] = sg.min + uint16[o + 3] * sg.step;
        }
        return out;
    }

    /**
     * 프레임 로딩: 멤버 영역에서 gzip 멤버 슬라이스 → gzip 복원 → uint16 → Float32Array
     * @param {number} frameIndex
     * @returns {Promise<{frameIndex:number, data:Float32Array, gphByLevel:Float32Array, validTime:string, ft:number}>}
     */
    async loadFrame(frameIndex) {
        const frame = this.frames[frameIndex];
        if (!frame) throw new Error(`존재하지 않는 프레임 인덱스: ${frameIndex}`);
        if (!this.memberRegion) throw new Error('loadBundle() 이 먼저 호출되어야 합니다');

        const t0 = performance.now();
        const gzMember = this.memberRegion.slice(frame.gzOffset, frame.gzOffset + frame.gzSize);
        const raw = await decompressGzip(gzMember);
        const uint16 = new Uint16Array(raw);
        const data = this.restoreFrame(uint16, frame.scale);

        const ms = (performance.now() - t0).toFixed(0);
        console.log(`--> 프레임 ${frame.ft} (idx ${frameIndex}) 로드 완료: ${data.length / 4} 포인트, ${ms}ms`);
        return {
            frameIndex,
            data,
            gphByLevel: new Float32Array(frame.gphByLevel),
            validTime: frame.validTime,
            ft: frame.ft
        };
    }
}

// ============================================================
// FramePool — LRU 캐시 + 인접 프레임 프리페치
// ============================================================
export class FramePool {
    /**
     * @param {WindDataLoader} loader  loadBundle() 이 호출된 로더
     * @param {number} capacity  LRU 캐시 용량 (프레임 수)
     */
    constructor(loader, capacity = 5) {
        this.loader = loader;
        this.capacity = capacity;
        this.cache = new Map();   // frameIndex -> { data, gphByLevel, validTime, ft } (삽입순 = LRU 순서)
        this.inflight = new Map(); // frameIndex -> Promise (동시 요청 중복 방지)
    }

    get frameCount() {
        return this.loader.frames.length;
    }

    /**
     * 프레임 인덱스 → 캐시된 프레임 (없으면 로딩 후 캐시)
     */
    async get(frameIndex) {
        if (frameIndex < 0 || frameIndex >= this.frameCount) {
            throw new Error(`프레임 인덱스 범위 오류: ${frameIndex}`);
        }
        // LRU: 접근 시 MRU 로 이동
        if (this.cache.has(frameIndex)) {
            const entry = this.cache.get(frameIndex);
            this.cache.delete(frameIndex);
            this.cache.set(frameIndex, entry);
            return entry;
        }
        if (this.inflight.has(frameIndex)) {
            return this.inflight.get(frameIndex);
        }
        const p = this.loader.loadFrame(frameIndex).then(entry => {
            this._put(frameIndex, entry);
            return entry;
        });
        this.inflight.set(frameIndex, p);
        try {
            return await p;
        } finally {
            this.inflight.delete(frameIndex);
        }
    }

    _put(frameIndex, entry) {
        this.cache.set(frameIndex, entry);
        while (this.cache.size > this.capacity) {
            const oldest = this.cache.keys().next().value;
            this.cache.delete(oldest);
        }
    }

    /**
     * 인접 프레임 프리페치 (현재 프레임 ±1, 캐시/로딩 중이 아닌 것만)
     */
    prefetchAround(frameIndex) {
        for (const idx of [frameIndex - 1, frameIndex + 1]) {
            if (idx < 0 || idx >= this.frameCount) continue;
            if (this.cache.has(idx) || this.inflight.has(idx)) continue;
            this.get(idx).catch(e => console.warn(`프리페치 실패 (idx ${idx}):`, e));
        }
    }

    /**
     * 캐시 전체 해제 (데이터셋 전환 시)
     */
    clear() {
        this.cache.clear();
        this.inflight.clear();
    }
}

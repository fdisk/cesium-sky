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
        const res = await fetch(bundleUrl);
        if (!res.ok) throw new Error(`번들 파일 로드 실패: ${res.status} ${bundleUrl}`);
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

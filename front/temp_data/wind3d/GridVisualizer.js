/**
 * GridVisualizer — 3D 격자 시각화
 *  - 'ground' : 지면(고도 0 + 오프셋)에 붙인 단순 단면 격자
 *  - 'levels' : 24개 고도 레벨까지 쌓아 올린 직육면체 격자
 *
 * Cesium.PolylineCollection (Primitive 서브클래스)을 사용해
 * 모든 선분을 단일 Primitive로 합쳐 렌더링
 * (WindLegendBox.renderBoundingBox 와 동일한 방식)
 *
 * step (격자 묶음): 매 step번째 격자선만 그려 N×N 셀을 1셀로 표현
 *  - step=10 이면 8km 격자(~9km) → ~90km 셀
 *  - 외곽 4변 경계선은 항상 강조(밝은 흰색)로 표시
 */
export class GridVisualizer {
    static CONFIG = {
        LINE_SAMPLES: 32,        // 수평 선분 세분화 수 (지구 곡면 추적)
        GROUND_OFFSET_M: 100,    // 지면 격자 z-fighting 방지 오프셋 (m)
        COLOR: Cesium.Color.WHITE.withAlpha(0.15),          // 내부 격자선
        BOUNDARY_COLOR: Cesium.Color.WHITE.withAlpha(0.35),  // 외곽 경계선 (강조)
        WIDTH: 2.0,             // 내부 격자선 두께 (셀이 커질수록 상대적으로 얇아 보임)
        BOUNDARY_WIDTH: 3.0     // 경계선 두께
    };

    constructor(viewer, metadata) {
        this.viewer = viewer;
        this.metadata = metadata;
        this.heightScale = 20.0;
        this.mode = 'ground';    // 'ground' | 'levels'
        this.visible = false;
        this.step = 1;           // 격자 묶음 간격 (1 = 모든 선)
        this.collection = null;

        const m = metadata;
        this.iCount = m.iCount;
        this.jCount = m.jCount;
        this.levelCount = m.levelCount || (m.plev ? m.plev.length : 24);

        const b = m.bounds;
        this.lon1 = b.lon1; this.lon2 = b.lon2;
        this.lat1 = b.lat1; this.lat2 = b.lat2;

        const gph = m.range.gph;
        this.gphMin = gph[0];
        this.gphMax = gph[1];
        // 레벨별 실제 기압고도 (없으면 선형 보간 폴백)
        this.gphByLevel = (m.gphByLevel && m.gphByLevel.length === this.levelCount)
            ? m.gphByLevel : null;
    }

    /**
     * k번째 레벨(0~levelCount-1)의 표시 고도 (m)
     * 레벨별 실제 기압고도(gphByLevel) 사용, 없으면 gphMin~gphMax 선형 보간 근사
     * (WindLegendBox.renderVerticalLabels 와 동일한 방식)
     */
    levelHeight(k) {
        if (this.gphByLevel) {
            return this.gphByLevel[k] * this.heightScale;
        }
        const t = this.levelCount > 1 ? k / (this.levelCount - 1) : 0;
        return (this.gphMin + (this.gphMax - this.gphMin) * t) * this.heightScale;
    }

    /**
     * 주어진 고도에서 격자 전체(경도선 + 위도선)을 PolylineCollection에 추가
     * - step 간격으로 선을 묶어 N×N 셀을 1셀로 표현
     * - 수평 선분은 LINE_SAMPLES 개로 세분화해 지구 곡면을 따라가게 함
     * - 외곽 4변 경계선은 BOUNDARY_COLOR 로 강조
     */
    collectGrid(collection, height) {
        const S = GridVisualizer.CONFIG.LINE_SAMPLES;
        const step = Math.max(1, Math.floor(this.step));
        const innerMat = Cesium.Material.fromType('Color', { color: GridVisualizer.CONFIG.COLOR });
        const boundMat = Cesium.Material.fromType('Color', { color: GridVisualizer.CONFIG.BOUNDARY_COLOR });

        const addLine = (lonFn, latFn, isBoundary) => {
            const pts = [];
            for (let s = 0; s <= S; s++) {
                const t = s / S;
                pts.push(Cesium.Cartesian3.fromDegrees(lonFn(t), latFn(t), height));
            }
            collection.add({
                positions: pts,
                width: isBoundary ? GridVisualizer.CONFIG.BOUNDARY_WIDTH : GridVisualizer.CONFIG.WIDTH,
                material: isBoundary ? boundMat : innerMat
            });
        };

        // j-고정 선 (경도 방향, lat1 → lat2)
        for (let j = 0; j < this.jCount; j += step) {
            const lat = this.lat1 + (this.lat2 - this.lat1) * (j / this.jCount);
            const isBoundary = (j === 0);
            addLine(
                (t) => this.lon1 + (this.lon2 - this.lon1) * t,
                () => lat,
                isBoundary
            );
        }
        // 북단 경계선 (jCount 위치 — step 배수가 아닐 수 있어 항상 추가)
        addLine(
            (t) => this.lon1 + (this.lon2 - this.lon1) * t,
            () => this.lat2,
            true
        );

        // i-고정 선 (위도 방향, lon1 → lon2)
        for (let i = 0; i < this.iCount; i += step) {
            const lon = this.lon1 + (this.lon2 - this.lon1) * (i / this.iCount);
            const isBoundary = (i === 0);
            addLine(
                () => lon,
                (t) => this.lat1 + (this.lat2 - this.lat1) * t,
                isBoundary
            );
        }
        // 동단 경계선 (iCount 위치 — step 배수가 아닐 수 있어 항상 추가)
        addLine(
            () => this.lon2,
            (t) => this.lat1 + (this.lat2 - this.lat1) * t,
            true
        );
    }

    /**
     * 현재 mode/heightScale/step 기준으로 PolylineCollection 재구성
     * (visible=false 이면 Collection 제거만 수행)
     */
    rebuild() {
        if (this.collection) {
            this.viewer.scene.primitives.remove(this.collection);
            this.collection = null;
        }
        if (!this.visible) return;

        this.collection = this.viewer.scene.primitives.add(new Cesium.PolylineCollection());

        if (this.mode === 'ground') {
            this.collectGrid(this.collection, GridVisualizer.CONFIG.GROUND_OFFSET_M);
        } else {
            for (let k = 0; k < this.levelCount; k++) {
                this.collectGrid(this.collection, this.levelHeight(k));
            }
        }
    }

    // 표시 여부 제어 (Collection 생성/제거)
    setShow(visible) {
        this.visible = visible;
        this.rebuild();
    }

    // 격자 모드 전환 ('ground' | 'levels')
    setMode(mode) {
        this.mode = mode;
        this.rebuild();
    }

    // 격자 묶음 간격 설정 (1 = 모든 선, 10 = 10×10 셀 묶음)
    setStep(step) {
        this.step = Math.max(1, Math.floor(step));
        this.rebuild();
    }

    // 고도 과장 배율 변경 (levels 모드일 때만 재구성 필요)
    updateHeightScale(newScale) {
        this.heightScale = newScale;
        if (this.mode === 'levels') {
            this.rebuild();
        }
    }

    /**
     * 파기 — PolylineCollection 제거 (데이터셋 전환 시 호출)
     */
    destroy() {
        if (this.collection) {
            this.viewer.scene.primitives.remove(this.collection);
            this.collection = null;
        }
    }
}

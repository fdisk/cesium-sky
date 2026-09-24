/**
 * Phase 3 - Clean 3D Bounding Box & 24 Level Legend
 */
export class WindLegendBox {
    constructor(viewer, metadata) {
        this.viewer = viewer;
        this.metadata = metadata;
        this.polylines = null;
        this.labelEntities = [];
        this.heightScale = 30.0;
    }

    init() {
        if (this.polylines) {
            this.viewer.scene.primitives.remove(this.polylines);
        }
        this.polylines = this.viewer.scene.primitives.add(new Cesium.PolylineCollection());

        this.renderBoundingBox();
        this.renderVerticalLabels();
    }

    renderBoundingBox() {
        if (!this.polylines) return;
        this.polylines.removeAll();

        const { bounds, range } = this.metadata;
        const minHgt = range.gph[0] * this.heightScale;
        const maxHgt = range.gph[1] * this.heightScale;

        const sw = [bounds.lon1, bounds.lat1];
        const se = [bounds.lon2, bounds.lat1];
        const ne = [bounds.lon2, bounds.lat2];
        const nw = [bounds.lon1, bounds.lat2];

        // [곡면 대응] 수평 모서리를 N개 샘플로 세분화해 타원체(지구) 곡면을 따라가게 함
        // (기존 2점 직선은 ECEF 좌표계에서 현(chord)이 되어 표면 아래로 꺼져 보임)
        const HORIZ_SAMPLES = 32;

        const horizontalEdge = (a, b, h) => {
            const pts = [];
            for (let s = 0; s <= HORIZ_SAMPLES; s++) {
                const t = s / HORIZ_SAMPLES;
                pts.push(Cesium.Cartesian3.fromDegrees(
                    a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t,
                    h
                ));
            }
            return pts;
        };

        // 수직 모서리는 지름(radial) 방향 직선이므로 2점 그대로 사용
        const verticalEdge = (lon, lat, h1, h2) => [
            Cesium.Cartesian3.fromDegrees(lon, lat, h1),
            Cesium.Cartesian3.fromDegrees(lon, lat, h2)
        ];

        const segments = [
            horizontalEdge(sw, se, minHgt), horizontalEdge(se, ne, minHgt),
            horizontalEdge(ne, nw, minHgt), horizontalEdge(nw, sw, minHgt), // 하단
            horizontalEdge(sw, se, maxHgt), horizontalEdge(se, ne, maxHgt),
            horizontalEdge(ne, nw, maxHgt), horizontalEdge(nw, sw, maxHgt), // 상단
            verticalEdge(sw[0], sw[1], minHgt, maxHgt),
            verticalEdge(se[0], se[1], minHgt, maxHgt),
            verticalEdge(ne[0], ne[1], minHgt, maxHgt),
            verticalEdge(nw[0], nw[1], minHgt, maxHgt)  // 기둥
        ];

        const boxColor = Cesium.Color.WHITE.withAlpha(0.75);

        segments.forEach(pts => {
            this.polylines.add({
                positions: pts,
                width: 2.0,
                material: Cesium.Material.fromType('Color', { color: boxColor })
            });
        });

        this.viewer.scene.globe.depthTestAgainstTerrain = false;
    }

    renderVerticalLabels() {
        this.labelEntities.forEach(e => this.viewer.entities.remove(e));
        this.labelEntities = [];

        const { bounds, plev, range } = this.metadata;
        const lon = bounds.lon1;
        const lat = bounds.lat1;

        const minGph = range.gph[0];
        const maxGph = range.gph[1];
        const levelCount = plev.length;

        for (let i = 0; i < levelCount; i++) {
            const hPa = plev[i];
            const approxHeightM = minGph + (maxGph - minGph) * (i / (levelCount - 1));
            const scaledHeight = approxHeightM * this.heightScale;

            const pos = Cesium.Cartesian3.fromDegrees(lon, lat, scaledHeight);
            const labelText = `${hPa} hPa (${(approxHeightM / 1000).toFixed(1)} km)`;

            const entity = this.viewer.entities.add({
                position: pos,
                label: {
                    text: labelText,
                    font: '12px sans-serif',
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 0,
                    showBackground: true,
                    // backgroundColor: new Cesium.Color(0.06, 0.09, 0.16, 0.75),
                    backgroundColor: new Cesium.Color(0.06, 0.09, 0.16, 0.0),
                    horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    pixelOffset: new Cesium.Cartesian2(-12, 0),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
            });

            this.labelEntities.push(entity);
        }
    }

    // [추가] 3D 범위 박스(PolylineCollection) 표시 여부 제어
    setBoxVisible(visible) {
        if (this.polylines) {
            this.polylines.show = visible;
        }
    }

    // [추가] 고도 레벨 텍스트 엔티티들 표시 여부 제어
    setTextVisible(visible) {
        this.labelEntities.forEach(entity => {
            entity.show = visible;
        });
    }

    updateHeightScale(newScale) {
        this.heightScale = newScale;
        this.renderBoundingBox();
        this.renderVerticalLabels();
    }

    /**
     * 파기 — 폴리라인 컬렉션 + 라벨 엔티티 제거 (데이터셋 전환 시 호출)
     */
    destroy() {
        if (this.polylines) {
            this.viewer.scene.primitives.remove(this.polylines);
            this.polylines = null;
        }
        this.labelEntities.forEach(e => this.viewer.entities.remove(e));
        this.labelEntities = [];
    }
}
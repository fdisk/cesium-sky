export class GpuParticleEngine {
    // ==========================================
    // [사용자 설정 상단 배치] 속도, 크기, 애니메이션 관련 파라미터
    // ==========================================
    static CONFIG = {
        DEFAULT_SPEED_FACTOR: 5.0,     // 기본 속도 배율
        DEFAULT_HEIGHT_SCALE: 30.0,    // 높이 스케일 배율
        PARTICLE_POINT_SIZE: 1.5,     // [머리 크기] 원하는 만큼 큼직하게 조절 가능!
        TAIL_LENGTH: 0.5,              // 꼬리 길이
        SHOW_LIMIT_SPEED: 1.0,        // 투명 처리할 최소 풍속 기준
        TAIL_SEGMENTS: 8,             // [핵심] 꼬리를 구성하는 선 조각 수 (촘촘할수록 매끄러운 선이 됨)
        SPIRAL_ON: false,             // 나선 표현 on/off
        SPIRAL_THRESHOLD: 20.0,       // 나선 시작 풍속 (m/s)
        SPIRAL_RADIUS_KM: 10.0,       // 나선 반경 (km) — 파티클 이동거리(~수백 km) 대비 충분히 커야 원형 나선으로 보임
        SPIRAL_TURNS: 0.5             // 파티클 수명당 회전 수
    };
    // static WIND_COLOR_MAP = [
    //     { speed: 0.0,  color: [240, 240, 240] }, // 연한 회색 (고요)
    //     { speed: 5.0,  color: [0, 255, 255] },   // 시안 (약한 바람)
    //     { speed: 12.0, color: [0, 0, 255] },     // 파랑
    //     { speed: 20.0, color: [0, 255, 0] },     // 초록
    //     { speed: 40.0, color: [128, 255, 0] },  // 연두색
    //     { speed: 50.0, color: [255, 255, 0] },   // 노랑
    //     { speed: 60.0, color: [255, 128, 0] },   // 주황
    //     { speed: 70.0, color: [255, 0, 0] }      // 빨강 (요청하신 맥스 부근: 기존 125 수준의 강렬한 레드)
    // ];
    static WIND_COLOR_MAP = [
        { speed: 0.0,   color: [255, 255, 255] }, //   0.0 knot : 흰색 (0 표기)
        { speed: 5.0,   color: [198, 241, 254] }, //   5.0 knot : 아주 연한 하늘색
        { speed: 10.0,  color: [148, 226, 254] }, //  10.0 knot : 연한 하늘색
        { speed: 15.0,  color: [92, 212, 255]  }, //  15.0 knot : 파란빛 하늘색
        { speed: 20.0,  color: [40, 198, 255]  }, //  20.0 knot : 밝은 파란색
        { speed: 25.0,  color: [3, 185, 255]   }, //  25.0 knot : 선명한 파란색 (25 표기)
        { speed: 30.0,  color: [0, 146, 248]   }, //  30.0 knot : 짙은 파란색
        { speed: 35.0,  color: [4, 57, 247]    }, //  35.0 knot : 보라빛 진파랑
        { speed: 40.0,  color: [4, 210, 20]    }, //  40.0 knot : 형광 연두색
        { speed: 45.0,  color: [0, 161, 0]     }, //  45.0 knot : 밝은 초록색
        { speed: 50.0,  color: [0, 121, 0]     }, //  50.0 knot : 중간 초록색 (50 표기)
        { speed: 55.0,  color: [0, 79, 0]      }, //  55.0 knot : 짙은 녹색 / 쑥색
        { speed: 60.0,  color: [189, 206, 78]  }, //  60.0 knot : 올리브 / 연두 노랑
        { speed: 65.0,  color: [255, 213, 10]  }, //  65.0 knot : 밝은 노란색
        { speed: 70.0,  color: [246, 193, 6]   }, //  70.0 knot : 짙은 노란색
        { speed: 75.0,  color: [231, 178, 8]   }, //  75.0 knot : 귤색 / 황토색 (75 표기)
        { speed: 80.0,  color: [212, 161, 3]   }, //  80.0 knot : 주황 노란색
        { speed: 85.0,  color: [253, 111, 6]   }, //  85.0 knot : 주황색
        { speed: 90.0,  color: [255, 67, 0]    }, //  90.0 knot : 주황 빨강
        { speed: 95.0,  color: [226, 22, 4]    }, //  95.0 knot : 선명한 빨간색
        { speed: 100.0, color: [192, 18, 0]    }, // 100.0 knot : 짙은 빨간색 / 적갈색 (100 표기)
        { speed: 115.0, color: [120, 20, 10]   }, // 115.0 knot : 아주 어두운 와인색
        { speed: 130.0, color: [50, 53, 52]    }, // 130.0 knot : 짙은 쥐색
        { speed: 150.0, color: [52, 52, 52]    }  // 150.0 knot : 어두운 회색 (150 표기 이상)
    ];
    
    constructor(viewer, metadata, binaryData, particleCount = 20000) {
        this.viewer = viewer;
        this.metadata = metadata;
        this.binaryData = binaryData;
        this.particleCount = particleCount;
        
        this.speedFactor = GpuParticleEngine.CONFIG.DEFAULT_SPEED_FACTOR;
        this.heightScale = GpuParticleEngine.CONFIG.DEFAULT_HEIGHT_SCALE;
        this.pointSize = GpuParticleEngine.CONFIG.PARTICLE_POINT_SIZE;
        this.showLimitSpeed = GpuParticleEngine.CONFIG.SHOW_LIMIT_SPEED;

        // 나선(사이클론) 표현: 특정 풍속 이상 파티클이 진행 방향을 축으로 나선 궤적을 그리도록
        this.spiralOn = GpuParticleEngine.CONFIG.SPIRAL_ON;
        this.spiralThreshold = GpuParticleEngine.CONFIG.SPIRAL_THRESHOLD;   // m/s
        this.spiralRadiusKm = GpuParticleEngine.CONFIG.SPIRAL_RADIUS_KM;   // km
        this.spiralTurns = GpuParticleEngine.CONFIG.SPIRAL_TURNS;          // 회전 수 / 파티클 수명

        // 풍속 필터 (파티클/단면도 공통): [min, max] 범위 밖 파티클은 숨김
        this.speedFilter = { min: 0.0, max: Infinity };

        this.isReady = false;
        
        this.clipBox = {
            minX: 0.0, maxX: 0.0,
            minY: 0.0, maxY: 1.0,
            minZ: 0.0, maxZ: 0.0
        };

        this.sliceVisibility = {
            x: true,
            y: true,
            z: false
        };

        this.layerVisibility = {
            low: true,
            mid: true,
            high: true
        };

        // 바람 성분 필터: u(동서), v(남북), w(연직) 토글 + w 증폭 게인
        this.componentVisibility = { u: true, v: true, w: true };
        this.componentGain = { u: 1.0, v: 1.0, w: 10.0 };

        this.tailPrimitive = null; // 꼬리 선 프리미티브
        this.headPrimitive = null; // 머리 점 프리미티브
        this.slicePrimitives = []; 

        this.legendContainer = null;
        this.pressureLabelsDom = null;

        this.init();
    }

    init() {
        this.parseMetadata();
        this.createParticlePrimitives();
        this.createLegendOverlay();
        this.updateSlicePlanes();
        this.isReady = true;
    }

    /**
     * 엔진 파기 — 모든 프리미티브/DOM 제거 (데이터셋 전환 시 호출)
     */
    destroy() {
        this.isReady = false;

        if (this.tailPrimitive) {
            this.viewer.scene.primitives.remove(this.tailPrimitive);
            this.tailPrimitive = null;
        }
        if (this.headPrimitive) {
            this.viewer.scene.primitives.remove(this.headPrimitive);
            this.headPrimitive = null;
        }
        this.slicePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        this.slicePrimitives = [];

        if (this.legendContainer) {
            const container = this.legendContainer.parentElement;
            if (container && container.id === 'custom-weather-legend') {
                container.remove();
            }
            this.legendContainer = null;
        }
        if (this.pressureLabelsDom) {
            this.pressureLabelsDom.remove();
            this.pressureLabelsDom = null;
        }
    }

    parseMetadata() {
        const meta = this.metadata || {};
        
        this.iCount = meta.iCount || meta.width || 50;
        this.jCount = meta.jCount || meta.height || 50;
        this.levelCount = meta.levelCount || meta.levels || 20;

        const b = meta.bounds;
        if (Array.isArray(b) && b.length >= 2) {
            this.lon1 = b[0][0]; this.lat1 = b[0][1];
            this.lon2 = b[1][0]; this.lat2 = b[1][1];
        } else if (b && typeof b === 'object') {
            this.lon1 = b.lon1 || 124.0; this.lon2 = b.lon2 || 132.0;
            this.lat1 = b.lat1 || 33.0; this.lat2 = b.lat2 || 43.0;
        } else {
            this.lon1 = 124.0; this.lon2 = 132.0;
            this.lat1 = 33.0; this.lat2 = 43.0;
        }

        const r = meta.range || meta.gphRange || {};
        const gph = r.gph || r.height || [0.0, 10000.0];
        this.gphMin = Array.isArray(gph) ? gph[0] : (gph.min || 0.0);
        this.gphMax = Array.isArray(gph) ? gph[1] : (gph.max || 10000.0);
    }

    setSpeedFactor(factor) { this.speedFactor = factor; }
    setHeightScale(scale) {
        this.heightScale = scale;
        this.createParticlePrimitives();
        this.updateSlicePlanes();
    }
    setPointSize(size) { 
        this.pointSize = size; 
    }
    updateUniforms() {}
    setClipBox(clipBox) {
        this.clipBox = clipBox;
        this.updateSlicePlanes(); 
    }
    setSliceVisibility(axis, isVisible) {
        if (this.sliceVisibility.hasOwnProperty(axis)) {
            this.sliceVisibility[axis] = isVisible;
            this.updateSlicePlanes();
        }
    }
    setLayerVisibility(layer, isVisible) {
        if (this.layerVisibility.hasOwnProperty(layer)) {
            this.layerVisibility[layer] = isVisible;
        }
    }
    /**
     * 바람 성분 가시성 설정 — 'u'(동서) / 'v'(남북) / 'w'(연직)
     * uniform만 갱신되어 파티클 재생성 없이 즉시 반영
     */
    setComponentVisibility(component, isVisible) {
        if (this.componentVisibility.hasOwnProperty(component)) {
            this.componentVisibility[component] = isVisible;
        }
    }
    /**
     * 바람 성분 증폭 게인 설정 (주로 w 연직바람 가시성 확보용)
     */
    setComponentGain(component, gain) {
        if (this.componentGain.hasOwnProperty(component)) {
            this.componentGain[component] = gain;
        }
    }
    /**
     * 풍속 필터 설정 — [min, max] m/s 범위 밖 파티클/단면도 픽셀은 숨김
     * (단면도 텍스처는 CPU 생성이라 재빌드 필요)
     */
    setSpeedFilter(min, max) {
        this.speedFilter = { min: min, max: max };
        this.updateSlicePlanes();
    }
    /**
     * 나선(사이클론) 표현 설정 — uniform만 갱신되어 파티클 재생성 없이 즉시 반영
     * @param {boolean} on        나선 효과 on/off
     * @param {number}  threshold 나선 시작 풍속 (m/s)
     * @param {number}  radiusKm  나선 반경 (km)
     * @param {number}  turns     파티클 수명당 회전 수
     */
    setSpiral(on, threshold, radiusKm, turns) {
        if (on !== undefined) this.spiralOn = !!on;
        if (threshold !== undefined) this.spiralThreshold = threshold;
        if (radiusKm !== undefined) this.spiralRadiusKm = radiusKm;
        if (turns !== undefined) this.spiralTurns = turns;
    }
    setLegendVisibility(showBox, showPressureLabels) {
        if (this.legendContainer) this.legendContainer.style.display = showBox ? 'block' : 'none';
        if (this.pressureLabelsDom) this.pressureLabelsDom.style.display = showPressureLabels ? 'block' : 'none';
    }

    getColorFromSpeed(speed) {
        const map = GpuParticleEngine.WIND_COLOR_MAP;
        if (speed <= map[0].speed) return map[0].color;
        if (speed >= map[map.length - 1].speed) return map[map.length - 1].color;

        for (let i = 0; i < map.length - 1; i++) {
            const curr = map[i];
            const next = map[i + 1];
            if (speed >= curr.speed && speed <= next.speed) {
                const t = (speed - curr.speed) / (next.speed - curr.speed);
                return [
                    Math.round(curr.color[0] + (next.color[0] - curr.color[0]) * t),
                    Math.round(curr.color[1] + (next.color[1] - curr.color[1]) * t),
                    Math.round(curr.color[2] + (next.color[2] - curr.color[2]) * t)
                ];
            }
        }
        return map[0].color;
    }

    /**
     * 도메인 크기에 맞는 바운딩 스피어 계산.
     * 도메인 4개 모서리(상단 고도)까지의 최대 거리 + 마진.
     * (고정 3000km는 한반도 크롭 영역에만 적합 — 전체 영역 데이터 시 가장자리 파티클이 컬링됨)
     */
    computeDomainBoundingSphere(centerCartesian) {
        const maxH = this.gphMax * this.heightScale;
        const corners = [
            Cesium.Cartesian3.fromDegrees(this.lon1, this.lat1, maxH),
            Cesium.Cartesian3.fromDegrees(this.lon2, this.lat1, maxH),
            Cesium.Cartesian3.fromDegrees(this.lon2, this.lat2, maxH),
            Cesium.Cartesian3.fromDegrees(this.lon1, this.lat2, maxH)
        ];
        let maxDist = 0;
        for (const c of corners) {
            const d = Cesium.Cartesian3.distance(centerCartesian, c);
            if (d > maxDist) maxDist = d;
        }
        return new Cesium.BoundingSphere(centerCartesian, maxDist * 1.2);
    }

    createParticlePrimitives() {
        if (this.tailPrimitive) {
            this.viewer.scene.primitives.remove(this.tailPrimitive);
            this.tailPrimitive = null;
        }
        if (this.headPrimitive) {
            this.viewer.scene.primitives.remove(this.headPrimitive);
            this.headPrimitive = null;
        }

        const segs = GpuParticleEngine.CONFIG.TAIL_SEGMENTS;
        // 각 셀당 2개 파티클: A=전체(u,v,w), B=w 전용(0,0,w)
        const totalParticles = this.particleCount * 2;
        const totalTailVertices = totalParticles * segs * 2;
        
        const tailPositions = new Float64Array(totalTailVertices * 3);
        const tailNormCoords = new Float32Array(totalTailVertices * 3);
        const tailVelocities = new Float32Array(totalTailVertices * 3);
        const tailRandomTimes = new Float32Array(totalTailVertices);
        const tailSegmentRatios = new Float32Array(totalTailVertices);
        const tailKinds = new Float32Array(totalTailVertices);
        const tailIndices = new Uint32Array(totalTailVertices);

        const headPositions = new Float64Array(totalParticles * 3);
        const headNormCoords = new Float32Array(totalParticles * 3);
        const headVelocities = new Float32Array(totalParticles * 3);
        const headRandomTimes = new Float32Array(totalParticles);
        const headKinds = new Float32Array(totalParticles);
        const headIndices = new Uint32Array(totalParticles);

        const dataView = new Float32Array(this.binaryData);
        const centerLon = (this.lon1 + this.lon2) / 2.0;
        const centerLat = (this.lat1 + this.lat2) / 2.0;
        const centerHeight = (this.gphMax * this.heightScale) / 2.0;
        const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, centerHeight);
        const boundingSphere = this.computeDomainBoundingSphere(centerCartesian);

        for (let i = 0; i < this.particleCount; i++) {
            const randI = Math.floor(Math.random() * this.iCount);
            const randJ = Math.floor(Math.random() * this.jCount);
            const randK = Math.floor(Math.random() * this.levelCount);

            const dataIdx = (randK * this.jCount * this.iCount + randJ * this.iCount + randI) * 4;
            const u = dataView[dataIdx] || 0.0;
            const v = dataView[dataIdx + 1] || 0.0;
            const w = dataView[dataIdx + 2] || 0.0;

            const normX = this.iCount > 1 ? randI / (this.iCount - 1) : 0;
            const normY = this.jCount > 1 ? randJ / (this.jCount - 1) : 0;
            const normZ = this.levelCount > 1 ? randK / (this.levelCount - 1) : 0;
            const randTime = Math.random() * 100.0;

            // 파티클 A: 전체 바람 (u, v, w) / 파티클 B: w 전용 (0, 0, w)
            const particles = [
                { idx: i * 2, vel: [u, v, w], kind: 0.0 },
                { idx: i * 2 + 1, vel: [0.0, 0.0, w], kind: 1.0 }
            ];

            for (const pt of particles) {
                const idx = pt.idx;

                headPositions[idx * 3 + 0] = centerCartesian.x;
                headPositions[idx * 3 + 1] = centerCartesian.y;
                headPositions[idx * 3 + 2] = centerCartesian.z;
                headNormCoords[idx * 3 + 0] = normX;
                headNormCoords[idx * 3 + 1] = normY;
                headNormCoords[idx * 3 + 2] = normZ;
                headVelocities[idx * 3 + 0] = pt.vel[0];
                headVelocities[idx * 3 + 1] = pt.vel[1];
                headVelocities[idx * 3 + 2] = pt.vel[2];
                headRandomTimes[idx] = randTime;
                headKinds[idx] = pt.kind;
                headIndices[idx] = idx;

                for (let s = 0; s < segs; s++) {
                    for (let p = 0; p < 2; p++) {
                        const tIdx = (idx * segs + s) * 2 + p;
                        const ratio = (s + p) / segs;

                        tailPositions[tIdx * 3 + 0] = centerCartesian.x;
                        tailPositions[tIdx * 3 + 1] = centerCartesian.y;
                        tailPositions[tIdx * 3 + 2] = centerCartesian.z;
                        tailNormCoords[tIdx * 3 + 0] = normX;
                        tailNormCoords[tIdx * 3 + 1] = normY;
                        tailNormCoords[tIdx * 3 + 2] = normZ;
                        tailVelocities[tIdx * 3 + 0] = pt.vel[0];
                        tailVelocities[tIdx * 3 + 1] = pt.vel[1];
                        tailVelocities[tIdx * 3 + 2] = pt.vel[2];
                        tailRandomTimes[tIdx] = randTime;
                        tailSegmentRatios[tIdx] = ratio;
                        tailKinds[tIdx] = pt.kind;
                        tailIndices[tIdx] = tIdx;
                    }
                }
            }
        }

        const tailGeometry = new Cesium.Geometry({
            attributes: {
                position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: tailPositions }),
                normCoord: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: tailNormCoords }),
                velocity: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: tailVelocities }),
                randTime: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, values: tailRandomTimes }),
                segmentRatio: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, values: tailSegmentRatios }),
                kind: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, values: tailKinds })
            },
            indices: tailIndices,
            primitiveType: Cesium.PrimitiveType.LINES,
            boundingSphere: boundingSphere
        });

        // ==========================================
        // [핵심] WIND_COLOR_MAP을 기반으로 GLSL 셰이더 함수 자동 생성
        // ==========================================
        const colorMap = GpuParticleEngine.WIND_COLOR_MAP;
        let shaderConditions = '';
        
        for (let i = 0; i < colorMap.length - 1; i++) {
            const curr = colorMap[i];
            const next = colorMap[i + 1];
            const cond = i === 0 ? 'if' : 'else if';
            
            shaderConditions += `
                ${cond} (s < ${next.speed.toFixed(1)}) {
                    return mix(vec3(${curr.color[0]}.0, ${curr.color[1]}.0, ${curr.color[2]}.0) / 255.0, vec3(${next.color[0]}.0, ${next.color[1]}.0, ${next.color[2]}.0) / 255.0, (s - ${curr.speed.toFixed(1)}) / ${(next.speed - curr.speed).toFixed(1)});
                }
            `;
        }
        const lastColor = colorMap[colorMap.length - 1].color;
        const maxSpeed = colorMap[colorMap.length - 1].speed;

        const dynamicShaderLib = `
            vec3 getShaderColor(float speed) {
                float s = clamp(speed, 0.0, ${maxSpeed.toFixed(1)});
                if (s <= ${colorMap[0].speed.toFixed(1)}) {
                    return vec3(${colorMap[0].color[0]}.0, ${colorMap[0].color[1]}.0, ${colorMap[0].color[2]}.0) / 255.0;
                }
                ${shaderConditions}
                else {
                    return vec3(${lastColor[0]}.0, ${lastColor[1]}.0, ${lastColor[2]}.0) / 255.0;
                }
            }

            vec3 geodeticToCartesian(vec3 lonLatHeight) {
                float lon = radians(lonLatHeight.x);
                float lat = radians(lonLatHeight.y);
                float h = lonLatHeight.z;
                float a = 6378137.0;
                float f = 1.0 / 298.257223563;
                float e2 = 2.0 * f - f * f;
                float sinLat = sin(lat);
                float cosLat = cos(lat);
                float N = a / sqrt(1.0 - e2 * sinLat * sinLat);
                float x = (N + h) * cosLat * cos(lon);
                float y = (N + h) * cosLat * sin(lon);
                float z = (N * (1.0 - e2) + h) * sinLat;
                return vec3(x, y, z);
            }
        `;

        const tailVS = `
            in vec3 position;
            in vec3 normCoord;
            in vec3 velocity;
            in float randTime;
            in float segmentRatio;
            in float kind;

            out vec4 v_color;
            uniform float u_time;
            uniform float u_speedFactor;
            uniform float u_heightScale;
            uniform vec2 u_lonRange;
            uniform vec2 u_latRange;
            uniform vec2 u_gphRange;
            uniform vec3 u_layerMask;
            uniform vec2 u_layerBounds;
            uniform vec2 u_speedRange;
            uniform vec3 u_componentMask;
            uniform vec3 u_componentGain;
            uniform float u_spiralOn;
            uniform float u_spiralThreshold;
            uniform float u_spiralRadius;
            uniform float u_spiralTurns;
 
            ${dynamicShaderLib}
 
            void main() {
                // Layer visibility filter (based on starting level)
                float layerMask = 0.0;
                if (normCoord.z < u_layerBounds.x) {
                    layerMask = u_layerMask.x;
                } else if (normCoord.z < u_layerBounds.y) {
                    layerMask = u_layerMask.y;
                } else {
                    layerMask = u_layerMask.z;
                }
                if (layerMask < 0.5) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    v_color = vec4(0.0, 0.0, 0.0, 0.0);
                    return;
                }
 
                // 바람 성분 필터:
                // - w 전용 파티클(kind=1): w만 체크(u,v off) 시에만 표시
                // - 전체 파티클(kind=0): u 또는 v 체크 시에만 표시 (모두 off 시에는 표시 안 함)
                float anyUV = max(u_componentMask.x, u_componentMask.y);
                float wOnlyMode = u_componentMask.z * (1.0 - anyUV);
                float compVisible = (kind > 0.5) ? wOnlyMode : anyUV;
                if (compVisible < 0.5) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    v_color = vec4(0.0, 0.0, 0.0, 0.0);
                    return;
                }
 
                // 성분 필터: 체크된 성분(u/v/w)만 속도에 적용
                vec3 vel = vec3(velocity.x * u_componentMask.x,
                                velocity.y * u_componentMask.y,
                                velocity.z * u_componentMask.z);
                // w 전용 파티클(kind=1): w gain으로 수직 운동 증폭
                if (kind > 0.5) {
                    vel.z *= u_componentGain.z;
                }
 
                // 풍속 필터: [u_speedRange.x, u_speedRange.y] 범위 밖 파티클은 숨김
                // w 전용 파티클(kind=1)은 순수 |w| 기준으로 필터/색상 계산 (w gain 증폭 전 원본 속도 사용)
                float speed = (kind > 0.5) ? abs(velocity.z) : length(vel);
                if (speed < u_speedRange.x || speed > u_speedRange.y) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    v_color = vec4(0.0, 0.0, 0.0, 0.0);
                    return;
                }
 
                float baseProgress = fract(u_time * 0.1 * u_speedFactor + randTime);
                float lifeProgress = max(0.0, baseProgress - segmentRatio * ${GpuParticleEngine.CONFIG.TAIL_LENGTH});
 
                vec3 currentPos = normCoord + vel * (lifeProgress * 0.0005 * u_speedFactor);
 
                // 나선(사이클론) offset: 특정 풍속 이상 전체 파티클(kind=0)만 적용
                if (u_spiralOn > 0.5 && kind < 0.5) {
                    float spiralAmt = smoothstep(u_spiralThreshold, u_spiralThreshold + 10.0, speed);
                    if (spiralAmt > 0.001) {
                        vec3 dir = normalize(vel + vec3(1e-6));
                        vec3 ref = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
                        vec3 side1 = normalize(cross(dir, ref));
                        vec3 side2 = cross(dir, side1);
                        float phase = lifeProgress * u_spiralTurns * 6.2831853;
                        currentPos += (side1 * cos(phase) + side2 * sin(phase)) * (u_spiralRadius * spiralAmt);
                    }
                }
 
                float lon = mix(u_lonRange.x, u_lonRange.y, currentPos.x);
                float lat = mix(u_latRange.x, u_latRange.y, currentPos.y);
                float gph = mix(u_gphRange.x, u_gphRange.y, currentPos.z);
 
                vec3 cartesianPos = geodeticToCartesian(vec3(lon, lat, gph * u_heightScale));
                gl_Position = czm_modelViewProjection * vec4(cartesianPos, 1.0);
 
                vec3 color = getShaderColor(speed);
                float alpha = (1.0 - segmentRatio) * smoothstep(0.0, 0.1, baseProgress) * (1.0 - smoothstep(0.9, 1.0, baseProgress));
                v_color = vec4(color, clamp(alpha * 0.8, 0.0, 1.0));
            }
        `;

        const tailFS = `
            in vec4 v_color;
            void main() {
                out_FragColor = v_color;
            }
        `;

        const self = this;
        this.tailPrimitive = new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({ geometry: tailGeometry }),
            appearance: new Cesium.Appearance({
                renderState: { blending: Cesium.BlendingState.ALPHA_BLEND, depthTest: { enabled: true }, depthMask: false },
                vertexShaderSource: tailVS,
                fragmentShaderSource: tailFS
            }),
            asynchronous: false
        });

        const headGeometry = new Cesium.Geometry({
            attributes: {
                position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: headPositions }),
                normCoord: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: headNormCoords }),
                velocity: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: headVelocities }),
                randTime: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, values: headRandomTimes }),
                kind: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, values: headKinds })
            },
            indices: headIndices,
            primitiveType: Cesium.PrimitiveType.POINTS,
            boundingSphere: boundingSphere
        });

        const headVS = `
            in vec3 position;
            in vec3 normCoord;
            in vec3 velocity;
            in float randTime;
            in float kind;

            out vec4 v_color;
            uniform float u_time;
            uniform float u_speedFactor;
            uniform float u_heightScale;
            uniform float u_pointSize;
            uniform vec2 u_lonRange;
            uniform vec2 u_latRange;
            uniform vec2 u_gphRange;
            uniform vec3 u_layerMask;
            uniform vec2 u_layerBounds;
            uniform vec2 u_speedRange;
            uniform vec3 u_componentMask;
            uniform vec3 u_componentGain;
            uniform float u_spiralOn;
            uniform float u_spiralThreshold;
            uniform float u_spiralRadius;
            uniform float u_spiralTurns;
 
            ${dynamicShaderLib}
 
            void main() {
                // Layer visibility filter (based on starting level)
                float layerMask = 0.0;
                if (normCoord.z < u_layerBounds.x) {
                    layerMask = u_layerMask.x;
                } else if (normCoord.z < u_layerBounds.y) {
                    layerMask = u_layerMask.y;
                } else {
                    layerMask = u_layerMask.z;
                }
                if (layerMask < 0.5) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    v_color = vec4(0.0, 0.0, 0.0, 0.0);
                    return;
                }
 
                // 바람 성분 필터:
                // - w 전용 파티클(kind=1): w만 체크(u,v off) 시에만 표시
                // - 전체 파티클(kind=0): u 또는 v 체크 시에만 표시 (모두 off 시에는 표시 안 함)
                float anyUV = max(u_componentMask.x, u_componentMask.y);
                float wOnlyMode = u_componentMask.z * (1.0 - anyUV);
                float compVisible = (kind > 0.5) ? wOnlyMode : anyUV;
                if (compVisible < 0.5) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    v_color = vec4(0.0, 0.0, 0.0, 0.0);
                    return;
                }
 
                // 성분 필터: 체크된 성분(u/v/w)만 속도에 적용
                vec3 vel = vec3(velocity.x * u_componentMask.x,
                                velocity.y * u_componentMask.y,
                                velocity.z * u_componentMask.z);
                // w 전용 파티클(kind=1): w gain으로 수직 운동 증폭
                if (kind > 0.5) {
                    vel.z *= u_componentGain.z;
                }
 
                // 풍속 필터: [u_speedRange.x, u_speedRange.y] 범위 밖 파티클은 숨김
                // w 전용 파티클(kind=1)은 순수 |w| 기준으로 필터/색상 계산 (w gain 증폭 전 원본 속도 사용)
                float speed = (kind > 0.5) ? abs(velocity.z) : length(vel);
                if (speed < u_speedRange.x || speed > u_speedRange.y) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    v_color = vec4(0.0, 0.0, 0.0, 0.0);
                    return;
                }
 
                float baseProgress = fract(u_time * 0.1 * u_speedFactor + randTime);
 
                vec3 currentPos = normCoord + vel * (baseProgress * 0.0005 * u_speedFactor);
 
                // 나선(사이클론) offset: 특정 풍속 이상 전체 파티클(kind=0)만 적용
                if (u_spiralOn > 0.5 && kind < 0.5) {
                    float spiralAmt = smoothstep(u_spiralThreshold, u_spiralThreshold + 10.0, speed);
                    if (spiralAmt > 0.001) {
                        vec3 dir = normalize(vel + vec3(1e-6));
                        vec3 ref = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
                        vec3 side1 = normalize(cross(dir, ref));
                        vec3 side2 = cross(dir, side1);
                        float phase = baseProgress * u_spiralTurns * 6.2831853;
                        currentPos += (side1 * cos(phase) + side2 * sin(phase)) * (u_spiralRadius * spiralAmt);
                    }
                }
 
                float lon = mix(u_lonRange.x, u_lonRange.y, currentPos.x);
                float lat = mix(u_latRange.x, u_latRange.y, currentPos.y);
                float gph = mix(u_gphRange.x, u_gphRange.y, currentPos.z);
 
                vec3 cartesianPos = geodeticToCartesian(vec3(lon, lat, gph * u_heightScale));
                gl_Position = czm_modelViewProjection * vec4(cartesianPos, 1.0);
 
                gl_PointSize = u_pointSize;
 
                vec3 color = getShaderColor(speed);
                float alpha = smoothstep(0.0, 0.1, baseProgress) * (1.0 - smoothstep(0.9, 1.0, baseProgress));
                v_color = vec4(color, clamp(alpha * 1.5, 0.0, 1.0));
            }
        `;

        const headFS = `
            in vec4 v_color;
            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                if (length(coord) > 0.5) {
                    discard;
                }
                out_FragColor = v_color;
            }
        `;

        this.headPrimitive = new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({ geometry: headGeometry }),
            appearance: new Cesium.Appearance({
                renderState: { blending: Cesium.BlendingState.ALPHA_BLEND, depthTest: { enabled: true }, depthMask: false },
                vertexShaderSource: headVS,
                fragmentShaderSource: headFS
            }),
            asynchronous: false
        });

        const setupPrimitiveUpdate = (primitive, geometry, attrLocs, type) => {
            primitive.update = function(frameState) {
                if (!this.command) {
                    this.command = new Cesium.DrawCommand({
                        boundingVolume: boundingSphere,
                        primitiveType: type,
                        pass: Cesium.Pass.TRANSLUCENT
                    });
                }

                this.command.uniformMap = {
                    u_time: function() { return performance.now() / 1000.0; },
                    u_speedFactor: function() { return self.speedFactor; },
                    u_heightScale: function() { return self.heightScale; },
                    u_pointSize: function() { return self.pointSize; },
                    u_lonRange: function() { return new Cesium.Cartesian2(self.lon1, self.lon2); },
                    u_latRange: function() { return new Cesium.Cartesian2(self.lat1, self.lat2); },
                    u_gphRange: function() { return new Cesium.Cartesian2(self.gphMin, self.gphMax); },
                    u_layerMask: function() {
                        return new Cesium.Cartesian3(
                            self.layerVisibility.low ? 1.0 : 0.0,
                            self.layerVisibility.mid ? 1.0 : 0.0,
                            self.layerVisibility.high ? 1.0 : 0.0
                        );
                    },
                    u_layerBounds: function() {
                        const lc = self.levelCount;
                        const lowMax = Math.floor(lc / 3);
                        const midMax = Math.floor(2 * lc / 3);
                        return new Cesium.Cartesian2(
                            lc > 1 ? lowMax / (lc - 1) : 0.333,
                            lc > 1 ? midMax / (lc - 1) : 0.667
                        );
                    },
                    u_speedRange: function() {
                        return new Cesium.Cartesian2(self.speedFilter.min, self.speedFilter.max);
                    },
                    u_componentMask: function() {
                        return new Cesium.Cartesian3(
                            self.componentVisibility.u ? 1.0 : 0.0,
                            self.componentVisibility.v ? 1.0 : 0.0,
                            self.componentVisibility.w ? 1.0 : 0.0
                        );
                    },
                    u_componentGain: function() {
                        return new Cesium.Cartesian3(
                            self.componentGain.u,
                            self.componentGain.v,
                            self.componentGain.w
                        );
                    },
                    u_spiralOn: function() {
                        return self.spiralOn ? 1.0 : 0.0;
                    },
                    u_spiralThreshold: function() {
                        return self.spiralThreshold;
                    },
                    u_spiralRadius: function() {
                        // km → normalized space: domain width ≈ lonRange * 111 * cos(midLat)
                        const midLat = (self.lat1 + self.lat2) / 2.0;
                        const domainKm = (self.lon2 - self.lon1) * 111.0 * Math.cos(midLat * Math.PI / 180.0);
                        return domainKm > 0 ? self.spiralRadiusKm / domainKm : 0.0;
                    },
                    u_spiralTurns: function() {
                        return self.spiralTurns;
                    }
                };

                const appearance = this.appearance;
                const context = frameState.context;

                if (!this.shaderProgram) {
                    this.shaderProgram = Cesium.ShaderProgram.fromCache({
                        context: context,
                        vertexShaderSource: appearance.vertexShaderSource,
                        fragmentShaderSource: appearance.fragmentShaderSource,
                        attributeLocations: attrLocs 
                    });
                }

                if (!this.vertexArray) {
                    this.vertexArray = Cesium.VertexArray.fromGeometry({
                        context: context,
                        geometry: geometry,
                        attributeLocations: attrLocs, 
                        bufferUsage: Cesium.BufferUsage.STATIC_DRAW
                    });
                }

                this.command.shaderProgram = this.shaderProgram;
                this.command.vertexArray = this.vertexArray;
                this.command.renderState = Cesium.RenderState.fromCache(appearance.renderState);

                frameState.commandList.push(this.command);
            };
        };

        setupPrimitiveUpdate(this.tailPrimitive, tailGeometry, { position: 0, normCoord: 1, velocity: 2, randTime: 3, segmentRatio: 4, kind: 5 }, Cesium.PrimitiveType.LINES);
        setupPrimitiveUpdate(this.headPrimitive, headGeometry, { position: 0, normCoord: 1, velocity: 2, randTime: 3, kind: 4 }, Cesium.PrimitiveType.POINTS);

        this.viewer.scene.primitives.add(this.tailPrimitive);
        this.viewer.scene.primitives.add(this.headPrimitive);
    }

    createLegendOverlay() {
        if (document.getElementById('custom-weather-legend')) return;

        const container = document.createElement('div');
        container.id = 'custom-weather-legend';
        container.style.position = 'absolute';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.zIndex = '999';
        container.style.pointerEvents = 'none';

        // WIND_COLOR_MAP 기반 그라데이션 CSS 및 눈금 생성
        const map = GpuParticleEngine.WIND_COLOR_MAP;
        
        // CSS gradient 스톱퍼 동적 생성
        const gradientStops = map.map((item, index) => {
            const percent = (index / (map.length - 1)) * 100;
            return `rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]}) ${percent}%`;
        }).join(', ');

        // 범례 아래 숫자 레이블 동적 생성
        const labelsHtml = map.map(item => {
            return `<span>${item.speed}</span>`;
        }).join('');

        const legendBox = document.createElement('div');
        legendBox.style.background = 'rgba(0, 0, 0, 0.75)';
        legendBox.style.padding = '10px';
        legendBox.style.borderRadius = '4px';
        legendBox.style.color = '#fff';
        legendBox.style.fontSize = '12px';
        legendBox.innerHTML = `
            <div style="margin-bottom: 5px; font-weight: bold;">풍속 (m/s) 범례</div>
            <div style="width: 180px; height: 10px; background: linear-gradient(to right, ${gradientStops});"></div>
            <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: 10px;">
                ${labelsHtml}
            </div>
        `;
        container.appendChild(legendBox);
        this.legendContainer = legendBox;

        const pressureLabels = document.createElement('div');
        pressureLabels.style.position = 'absolute';
        pressureLabels.style.bottom = '120px';
        pressureLabels.style.right = '0px';
        pressureLabels.style.background = 'rgba(0, 0, 0, 0.6)';
        pressureLabels.style.padding = '6px';
        pressureLabels.style.borderRadius = '4px';
        pressureLabels.style.color = '#fff';
        pressureLabels.style.fontSize = '11px';
        pressureLabels.style.lineHeight = '1.3';
        pressureLabels.innerHTML = `
            50 hPa (20.6 km)<br>70 hPa (19.7 km)<br>100 hPa (18.8 km)<br>150 hPa (17.9 km)<br>
            200 hPa (17.0 km)<br>250 hPa (16.1 km)<br>300 hPa (15.2 km)<br>350 hPa (14.4 km)<br>
            400 hPa (13.5 km)<br>450 hPa (12.6 km)<br>500 hPa (11.7 km)<br>550 hPa (10.8 km)<br>
            600 hPa (9.9 km)<br>650 hPa (9.0 km)<br>700 hPa (8.1 km)<br>750 hPa (7.2 km)<br>
            800 hPa (6.3 km)<br>850 hPa (5.5 km)<br>875 hPa (4.6 km)<br>900 hPa (3.7 km)<br>
            925 hPa (2.8 km)<br>950 hPa (1.9 km)<br>975 hPa (1.0 km)<br>1000 hPa (0.1 km)
        `;
        container.appendChild(pressureLabels);
        this.pressureLabelsDom = pressureLabels;

        document.body.appendChild(container);
    }

    /**
     * 단면도 픽셀 가시성: showLimitSpeed + 풍속 필터([min, max]) 모두 통과해야 표시
     */
    isSpeedVisible(speed) {
        if (speed < this.showLimitSpeed) return false;
        if (speed < this.speedFilter.min || speed > this.speedFilter.max) return false;
        return true;
    }

    updateSlicePlanes() {
        this.slicePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        this.slicePrimitives = [];

        const dataView = new Float32Array(this.binaryData);

        if (this.sliceVisibility.z) {
            const zPlane = this.createHorizontalSlice(dataView, this.clipBox.maxZ);
            if (zPlane) {
                this.viewer.scene.primitives.add(zPlane);
                this.slicePrimitives.push(zPlane);
            }
        }

        if (this.sliceVisibility.x) {
            const xPlane = this.createXVerticalSlice(dataView, this.clipBox.maxX);
            if (xPlane) {
                this.viewer.scene.primitives.add(xPlane);
                this.slicePrimitives.push(xPlane);
            }
        }

        if (this.sliceVisibility.y) {
            const yPlane = this.createYVerticalSlice(dataView, this.clipBox.maxY);
            if (yPlane) {
                this.viewer.scene.primitives.add(yPlane);
                this.slicePrimitives.push(yPlane);
            }
        }
    }

    /**
     * [곡면 대응] (u,v) → Cartesian3 매핑 함수로 격자 메시를 생성.
     * 4점 직사각형은 ECEF 좌표계에서 현(chord)이 되어 지구 곡면 아래로 꺼지므로,
     * 격자 정점을 fromDegrees(타원체 좌표)로 채워 곡면을 따라가게 한다.
     */
    buildCurvedPlaneGeometry(posFn, nu, nv) {
        const positions = new Float64Array((nu + 1) * (nv + 1) * 3);
        const uvs = new Float32Array((nu + 1) * (nv + 1) * 2);

        for (let j = 0; j <= nv; j++) {
            for (let i = 0; i <= nu; i++) {
                const u = i / nu;
                const v = j / nv;
                const p = posFn(u, v);
                const idx = (j * (nu + 1) + i) * 3;
                positions[idx] = p.x;
                positions[idx + 1] = p.y;
                positions[idx + 2] = p.z;
                uvs[(j * (nu + 1) + i) * 2] = u;
                uvs[(j * (nu + 1) + i) * 2 + 1] = v;
            }
        }

        const indices = new Uint32Array(nu * nv * 6);
        let k = 0;
        for (let j = 0; j < nv; j++) {
            for (let i = 0; i < nu; i++) {
                const a = j * (nu + 1) + i;
                const b = a + 1;
                const c = a + (nu + 1);
                const d = c + 1;
                indices[k++] = a; indices[k++] = c; indices[k++] = b;
                indices[k++] = b; indices[k++] = c; indices[k++] = d;
            }
        }

        return new Cesium.Geometry({
            attributes: {
                position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
                st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: uvs })
            },
            indices: indices,
            primitiveType: Cesium.PrimitiveType.TRIANGLES,
            boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
        });
    }

    createHorizontalSlice(dataView, zRatio) {
        const maxH = this.gphMax * this.heightScale;
        const currentHeight = maxH * zRatio;

        // [곡면 대응] 수평 평면은 경도/위도 방향 모두 곡면이므로 2차원 격자 세분화
        const geometry = this.buildCurvedPlaneGeometry((u, v) => {
            const lon = this.lon1 + (this.lon2 - this.lon1) * u;
            const lat = this.lat1 + (this.lat2 - this.lat1) * v;
            return Cesium.Cartesian3.fromDegrees(lon, lat, currentHeight);
        }, 32, 32);

        const width = this.iCount;
        const height = this.jCount;
        const targetLevel = Math.floor(zRatio * (this.levelCount - 1));
        const pixelData = new Uint8Array(width * height * 4);

        for (let j = 0; j < height; j++) {
            const actualJ = height - 1 - j;
            for (let i = 0; i < width; i++) {
                const dataIdx = (targetLevel * height * width + actualJ * width + i) * 4;
                const u = dataView[dataIdx] || 0.0;
                const v = dataView[dataIdx + 1] || 0.0;

                const speed = Math.sqrt(u * u + v * v);
                const pIdx = (j * width + i) * 4;

                if (!this.isSpeedVisible(speed)) {
                    pixelData[pIdx] = 0; pixelData[pIdx + 1] = 0; pixelData[pIdx + 2] = 0; pixelData[pIdx + 3] = 0;
                } else {
                    const rgb = this.getColorFromSpeed(speed);
                    pixelData[pIdx] = rgb[0]; pixelData[pIdx + 1] = rgb[1]; pixelData[pIdx + 2] = rgb[2]; pixelData[pIdx + 3] = 220;
                }
            }
        }

        return this.buildSlicePrimitive(geometry, pixelData, width, height);
    }

    createXVerticalSlice(dataView, xRatio) {
        const currentLon = mix(this.lon1, this.lon2, xRatio);
        const minH = 0.0;
        const maxH = this.gphMax * this.heightScale;

        // [곡면 대응] u=위도(곡면 축, 세분화), v=고도(radial 직선 축, 2점)
        const geometry = this.buildCurvedPlaneGeometry((u, v) => {
            const lat = this.lat1 + (this.lat2 - this.lat1) * u;
            const h = minH + (maxH - minH) * v;
            return Cesium.Cartesian3.fromDegrees(currentLon, lat, h);
        }, 32, 2);

        const width = this.jCount; 
        const height = this.levelCount; 
        const targetI = Math.floor(xRatio * (this.iCount - 1));
        const pixelData = new Uint8Array(width * height * 4);

        for (let k = 0; k < height; k++) {
            const actualK = height - 1 - k;
            for (let j = 0; j < width; j++) {
                const dataIdx = (actualK * this.jCount * this.iCount + j * this.iCount + targetI) * 4;
                const u = dataView[dataIdx] || 0.0;
                const v = dataView[dataIdx + 1] || 0.0;

                const speed = Math.sqrt(u * u + v * v);
                const pIdx = (k * width + j) * 4;

                if (!this.isSpeedVisible(speed)) {
                    pixelData[pIdx] = 0; pixelData[pIdx + 1] = 0; pixelData[pIdx + 2] = 0; pixelData[pIdx + 3] = 0;
                } else {
                    const rgb = this.getColorFromSpeed(speed);
                    pixelData[pIdx] = rgb[0]; pixelData[pIdx + 1] = rgb[1]; pixelData[pIdx + 2] = rgb[2]; pixelData[pIdx + 3] = 220;
                }
            }
        }

        return this.buildSlicePrimitive(geometry, pixelData, width, height);
    }

    createYVerticalSlice(dataView, yRatio) {
        const currentLat = mix(this.lat1, this.lat2, yRatio);
        const minH = 0.0;
        const maxH = this.gphMax * this.heightScale;

        // [곡면 대응] u=경도(곡면 축, 세분화), v=고도(radial 직선 축, 2점)
        const geometry = this.buildCurvedPlaneGeometry((u, v) => {
            const lon = this.lon1 + (this.lon2 - this.lon1) * u;
            const h = minH + (maxH - minH) * v;
            return Cesium.Cartesian3.fromDegrees(lon, currentLat, h);
        }, 32, 2);

        const width = this.iCount; 
        const height = this.levelCount; 
        const targetJ = Math.floor(yRatio * (this.jCount - 1));
        const pixelData = new Uint8Array(width * height * 4);

        for (let k = 0; k < height; k++) {
            const actualK = height - 1 - k;
            for (let i = 0; i < width; i++) {
                const dataIdx = (actualK * this.jCount * this.iCount + targetJ * this.iCount + i) * 4;
                const u = dataView[dataIdx] || 0.0;
                const v = dataView[dataIdx + 1] || 0.0;
                const speed = Math.sqrt(u * u + v * v);
                const pIdx = (k * width + i) * 4;

                if (!this.isSpeedVisible(speed)) {
                    pixelData[pIdx] = 0; pixelData[pIdx + 1] = 0; pixelData[pIdx + 2] = 0; pixelData[pIdx + 3] = 0;
                } else {
                    const rgb = this.getColorFromSpeed(speed);
                    pixelData[pIdx] = rgb[0]; pixelData[pIdx + 1] = rgb[1]; pixelData[pIdx + 2] = rgb[2]; pixelData[pIdx + 3] = 220;
                }
            }
        }

        return this.buildSlicePrimitive(geometry, pixelData, width, height);
    }
    
    buildSlicePrimitive(geometry, pixelData, width, height) {
        const primitive = new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({ geometry: geometry }),
            appearance: new Cesium.Appearance({
                renderState: {
                    blending: Cesium.BlendingState.ALPHA_BLEND,
                    depthTest: { enabled: true },
                    depthMask: true
                },
                vertexShaderSource: `
                    in vec3 position;
                    in vec2 st;
                    out vec2 v_st;
                    void main() {
                        v_st = st;
                        gl_Position = czm_modelViewProjection * vec4(position, 1.0);
                    }
                `,
                fragmentShaderSource: `
                    in vec2 v_st;
                    uniform sampler2D u_sliceTexture;
                    void main() {
                        out_FragColor = texture(u_sliceTexture, v_st);
                    }
                `
            }),
            asynchronous: false
        });

        primitive.update = function(frameState) {
            if (!this.command) {
                this.command = new Cesium.DrawCommand({
                    boundingVolume: geometry.boundingSphere,
                    primitiveType: Cesium.PrimitiveType.TRIANGLES,
                    pass: Cesium.Pass.TRANSLUCENT
                });
            }

            if (!this._texture && frameState.context) {
                this._texture = new Cesium.Texture({
                    context: frameState.context,
                    width: width,
                    height: height,
                    source: { arrayBufferView: pixelData, width: width, height: height },
                    pixelFormat: Cesium.PixelFormat.RGBA,
                    pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
                    minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
                    magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST
                });
            }

            this.command.uniformMap = {
                u_sliceTexture: () => this._texture
            };

            const appearance = this.appearance;
            const context = frameState.context;

            if (!this.shaderProgram) {
                this.shaderProgram = Cesium.ShaderProgram.fromCache({
                    context: context,
                    vertexShaderSource: appearance.vertexShaderSource,
                    fragmentShaderSource: appearance.fragmentShaderSource,
                    attributeLocations: { position: 0, st: 1 }
                });
            }

            if (!this.vertexArray) {
                this.vertexArray = Cesium.VertexArray.fromGeometry({
                    context: context,
                    geometry: geometry,
                    attributeLocations: { position: 0, st: 1 },
                    bufferUsage: Cesium.BufferUsage.STATIC_DRAW
                });
            }

            this.command.shaderProgram = this.shaderProgram;
            this.command.vertexArray = this.vertexArray;
            this.command.renderState = Cesium.RenderState.fromCache(appearance.renderState);

            frameState.commandList.push(this.command);
        };

        return primitive;
    }
}

function mix(x, y, a) {
    return x * (1.0 - a) + y * a;
}
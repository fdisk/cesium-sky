import { WindDataLoader } from './WindDataLoader.js';
const vertShaderSource = await (await fetch('./particle3D.vert')).text();
const fragShaderSource = await (await fetch('./particle3D.frag')).text();

export class CesiumWindEngine3D {
    constructor(viewer, config = {}) {
        this.viewer = viewer;
        this.particleCount = config.particleCount || 100000; // 기본 10만 개 (참고 영상 수준)
        this.loader = new WindDataLoader();
        this.isReady = false;
    }

    async init(jsonUrl, binUrl) {
        const { metadata, windDataArray } = await this.loader.load(jsonUrl, binUrl);
        this.metadata = metadata;
        
        // 1. 파티클 버퍼 초기화 (10만 개 3D 랜덤 좌표 배치)
        this.initParticleBuffers();

        // 2. Cesium Custom Primitive / PostProcessStage 추가
        this.setupCesiumParticleStage();

        this.isReady = true;
        console.log("--> GPU 3D Particle Engine 준비 완료! (파티클 수: " + this.particleCount + "개)");
    }

    initParticleBuffers() {
        const positions = new Float32Array(this.particleCount * 3);
        for (let i = 0; i < this.particleCount; i++) {
            positions[i * 3 + 0] = Math.random(); // Norm Lon (0~1)
            positions[i * 3 + 1] = Math.random(); // Norm Lat (0~1)
            positions[i * 3 + 2] = Math.random(); // Norm Level/Alt (0~1)
        }
        this.particlePositions = positions;
    }

    setupCesiumParticleStage() {
        const scene = this.viewer.scene;
        const self = this;

        // Cesium Primitive 규격에 맞춰 destroy / isDestroyed 메서드를 포함한 커스텀 Primitive 객체 생성
        const customParticlePrimitive = {
            _destroyed: false,
            
            update: function (frameState) {
                if (!self.isReady || this._destroyed) return;
                self.renderParticles(frameState);
            },
            
            isDestroyed: function () {
                return this._destroyed;
            },
            
            destroy: function () {
                this._destroyed = true;
                return Cesium.destroyObject(this);
            }
        };

        // primitives 컬렉션에 추가
        scene.primitives.add(customParticlePrimitive);
    }

    renderParticles(frameState) {
        // GPU Compute / Transform Feedback을 통한 60 FPS 좌표 업데이트 및 DrawCall 수행
    }
}
/**
 * Phase 2 - 3D Wind Data Loader
 */
export class WindDataLoader {
    constructor() {
        this.metadata = null;
        this.windDataArray = null; // Float32Array [U, V, W, GPH, U, V, W, GPH, ...]
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
     * WebGL2 3D Texture 생성 (U, V, W, GPH 4채널 RGBA32F)
     */
    create3DDataTexture(gl) {
        const { iCount, jCount, levelCount } = this.metadata;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, texture);

        // 텍스처 보간 설정 (Trilinear Interpolation 지원)
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

        // 24개 등압면 볼륨을 RGBA32F 포맷 3D Texture로 GPU에 업로드
        gl.texImage3D(
            gl.TEXTURE_3D,
            0,
            gl.RGBA32F,
            iCount,
            jCount,
            levelCount,
            0,
            gl.RGBA,
            gl.FLOAT,
            this.windDataArray
        );

        gl.bindTexture(gl.TEXTURE_3D, null);
        return texture;
    }
}
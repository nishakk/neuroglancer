/**
 * @license
 * Copyright 2016 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MultiscaleSliceViewChunkSource, SliceViewChunk, SliceViewChunkSource} from 'neuroglancer/sliceview/frontend';
import {SliceView} from 'neuroglancer/sliceview/frontend';
import {RenderLayer as GenericSliceViewRenderLayer} from 'neuroglancer/sliceview/renderlayer';
import {VECTOR_GRAPHICS_RENDERLAYER_RPC_ID, VectorGraphicsChunkSource as VectorGraphicsChunkSourceInterface, VectorGraphicsChunkSpecification, VectorGraphicsSourceOptions} from 'neuroglancer/sliceview/vector_graphics/base';
import {Buffer} from 'neuroglancer/webgl/buffer';
import {GL} from 'neuroglancer/webgl/context';
import {ShaderBuilder, ShaderProgram} from 'neuroglancer/webgl/shader';
import {RpcId, SharedObject} from 'neuroglancer/worker_rpc';

export abstract class RenderLayer extends GenericSliceViewRenderLayer {
  sources: VectorGraphicsChunkSource[][];
  shader: ShaderProgram|undefined = undefined;
  shaderUpdated = true;
  rpcId: RpcId|null = null;

  constructor(multiscaleSource: MultiscaleVectorGraphicsChunkSource, {
    sourceOptions = <VectorGraphicsSourceOptions> {}
  } = {}) {
    super(multiscaleSource.chunkManager, multiscaleSource.getSources(sourceOptions));

    let sharedObject = this.registerDisposer(new SharedObject());
    sharedObject.RPC_TYPE_ID = VECTOR_GRAPHICS_RENDERLAYER_RPC_ID;
    sharedObject.initializeCounterpart(this.chunkManager.rpc!, {'sources': this.sourceIds});
    this.rpcId = sharedObject.rpcId;
  }

  defineShader(builder: ShaderBuilder) {
    builder.addFragmentCode(`
void emit(vec4 color) {
  gl_FragColor = color;
}
void emitRGBA(vec4 rgba) {
  emit(vec4(rgba.rgb, rgba.a * uOpacity));
}
void emitRGB(vec3 rgb) {
  emit(vec4(rgb, uOpacity));
}
void emitGrayscale(float value) {
  emit(vec4(value, value, value, uOpacity));
}
void emitTransparent() {
  emit(vec4(0.0, 0.0, 0.0, 0.0));
}
`);
  }

  beginSlice(_sliceView: SliceView) {
    let shader = this.shader!;
    shader.bind();
    return shader;
  }

  abstract endSlice(shader: ShaderProgram): void;

  abstract draw(sliceView: SliceView): void;
}

export class VectorGraphicsChunk extends SliceViewChunk {
  source: VectorGraphicsChunkSource;
  vertexPositions: Float32Array;
  vertexBuffer: Buffer;
  numPoints: number;

  constructor(source: VectorGraphicsChunkSource, x: any) {
    super(source, x);
    this.vertexPositions = x['vertexPositions'];
    this.numPoints = Math.floor(this.vertexPositions.length / 3);
  }

  copyToGPU(gl: GL) {
    super.copyToGPU(gl);
    this.vertexBuffer = Buffer.fromData(gl, this.vertexPositions, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
  }

  freeGPUMemory(gl: GL) {
    super.freeGPUMemory(gl);
    this.vertexBuffer.dispose();
  }
}

export class VectorGraphicsChunkSource extends SliceViewChunkSource implements
    VectorGraphicsChunkSourceInterface {
  chunks: Map<string, VectorGraphicsChunk>;
  spec: VectorGraphicsChunkSpecification;

  getChunk(x: any): VectorGraphicsChunk {
    return new VectorGraphicsChunk(this, x);
  }

  /**
   * Specifies whether the point vertex coordinates are specified in units of voxels rather than
   * nanometers.
   */
  get vectorGraphicsCoordinatesInVoxels() {
    return true;
  }
}

export interface MultiscaleVectorGraphicsChunkSource extends MultiscaleSliceViewChunkSource {
  /**
   * @return Chunk sources for each scale, ordered by increasing minVoxelSize.  For each scale,
   * there may be alternative sources with different chunk layouts.
   */
  getSources: (options: VectorGraphicsSourceOptions) => VectorGraphicsChunkSource[][];
}

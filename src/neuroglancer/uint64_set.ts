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

import {HashSetUint64} from 'neuroglancer/gpu_hash/hash_table';
import {Signal} from 'neuroglancer/util/signal';
import {Uint64} from 'neuroglancer/util/uint64';
import {registerRPC, registerSharedObject, RPC, SharedObjectCounterpart} from 'neuroglancer/worker_rpc';

@registerSharedObject('Uint64Set')
export class Uint64Set extends SharedObjectCounterpart {
  hashTable = new HashSetUint64();
  changed = new Signal<(x: Uint64 | Uint64[] | null, add: boolean) => void>();

  static makeWithCounterpart(rpc: RPC) {
    let obj = new Uint64Set();
    obj.initializeCounterpart(rpc);
    return obj;
  }

  disposed() {
    super.disposed();
    this.hashTable = <any>undefined;
    this.changed = <any>undefined;
  }

  reserve_(x: number) {
    return this.hashTable.reserve(x);
  }

  reserve(x: number) {
    if (this.reserve_(x)) {
      let {rpc} = this;
      if (rpc) {
        rpc.invoke('Uint64Set.reserve', {'id': this.rpcId, 'value': x});
      }
    }
  }

  add_(x: Uint64[]) {
    let changed = false;
    for (const v of x) {
      changed = this.hashTable.add(v) || changed;
    }
    return changed;
  }

  add(x: Uint64|Uint64[]) {
    const tmp = Array<Uint64>().concat(x);
    if (this.add_(tmp)) {
      let {rpc} = this;
      if (rpc) {
        rpc.invoke('Uint64Set.add', {'id': this.rpcId, 'value': tmp});
      }
      this.changed.dispatch(x, true);
    }
  }

  has(x: Uint64) {
    return this.hashTable.has(x);
  }

  [Symbol.iterator]() {
    return this.hashTable.keys();
  }

  delete_(x: Uint64[]) {
    let changed = false;
    for (const v of x) {
      changed = this.hashTable.delete(v) || changed;
    }
    return changed;
  }

  delete(x: Uint64|Uint64[]) {
    const tmp = Array<Uint64>().concat(x);
    if (this.delete_(Array<Uint64>().concat(x))) {
      let {rpc} = this;
      if (rpc) {
        rpc.invoke('Uint64Set.delete', {'id': this.rpcId, 'value': tmp});
      }
      this.changed.dispatch(x, false);
    }
  }

  get size() {
    return this.hashTable.size;
  }

  clear() {
    if (this.hashTable.clear()) {
      let {rpc} = this;
      if (rpc) {
        rpc.invoke('Uint64Set.clear', {'id': this.rpcId});
      }
      this.changed.dispatch(null, false);
    }
  }

  toJSON() {
    let result = new Array<string>();
    for (let id of this) {
      result.push(id.toString());
    }
    // Need to sort entries, otherwise serialization changes every time.
    result.sort();
    return result;
  }
}

registerRPC('Uint64Set.reserve', function(x) {
  let obj = this.get(x['id']);
  if (obj.reserve_(x['value'])) {
    obj.changed.dispatch();
  }
});

registerRPC('Uint64Set.add', function(x) {
  let obj = this.get(x['id']);
  if (obj.add_(x['value'])) {
    obj.changed.dispatch();
  }
});

registerRPC('Uint64Set.delete', function(x) {
  let obj = this.get(x['id']);
  if (obj.delete_(x['value'])) {
    obj.changed.dispatch();
  }
});

registerRPC('Uint64Set.clear', function(x) {
  let obj = this.get(x['id']);
  if (obj.hashTable.clear()) {
    obj.changed.dispatch();
  }
});

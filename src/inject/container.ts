import { alg, Graph } from 'graphlib';
import { getClassConstructorParams, getClassInjectionInformation, getClassMethodParams, inject, InjectParameter, LazyRef } from './decorators';
import { InstanceProvider } from './provider';
import { getOrDefault } from './utils';


/**
 * inject container
 */
export class InjectContainer {

  private _store: Map<any, any>

  private _providers: Map<any, InstanceProvider>

  constructor() {
    this._providers = new Map();
    this._store = new Map();
  }

  public registerProvider(provider: InstanceProvider) {
    this._providers.set(provider.type, provider);
  }

  async getInstance<T extends new (...args: any[]) => any>(type: LazyRef<T>): Promise<InstanceType<T>>;
  async getInstance<T extends new (...args: any[]) => any>(type: T): Promise<InstanceType<T>>;
  async getInstance(type: string): Promise<any>;
  async getInstance(type) {

    if (type instanceof LazyRef) {
      type = type.getRef();
    }

    if (type == InjectContainer) {
      return this;
    }

    // if class has cycle dependency in constructor, throw error
    this._checkDependency(type);

    if (this.hasInProviders(type)) {

      const provider = this.getProvider(type);

      if (!this.hasInStore(type)) {
        const inst = await this.injectExecute(provider, provider.provide);
        this.setStore(type, inst);
      }

      return this.getStore(type);

    }

    if (typeof type == 'function') {
      return await this._defaultClassProvider(type);
    }

    throw new TypeError(`Not found provider for type: '${type?.name || type}'`);

  }

  protected hasInStore(type) {
    if (typeof type == 'function') {
      for (const [k] of this._store) {
        if (k.prototype instanceof type) {
          return true;
        }
      }
    }
    return this._store.has(type);
  }

  protected setStore(type, value) {
    this._store.set(type, value);
  }

  protected getStore(type) {
    if (typeof type == 'function') {
      for (const [k, v] of this._store) {
        if (k.prototype instanceof type) {
          return v;
        }
      }
    }
    return this._store.get(type);
  }

  protected hasInProviders(type) {
    if (typeof type == 'function') {
      for (const [k] of this._providers) {
        if (k.prototype instanceof type) {
          return true;
        }
      }
    }
    return this._providers.has(type);
  }

  protected getProvider(type) {
    if (typeof type == 'function') {
      for (const [k, p] of this._providers) {
        if (k.prototype instanceof type) {
          return p;
        }
      }
    }
    return this._providers.get(type);
  }


  /**
   * execute class instance method with inject
   *
   * @param instance
   * @param method
   */
  async injectExecute(instance: any, method: Function) {
    const methodName = method.name;
    const type = instance.constructor;
    const paramsInfo = getClassMethodParams(type, methodName);
    const params = [];

    if (paramsInfo.length > 0) {
      for (let idx = 0; idx < paramsInfo.length; idx++) {
        const paramInfo = paramsInfo[idx];
        params[paramInfo.parameterIndex] = await this.getInstance(paramInfo.type);
      }
    }

    return method.apply(instance, params);
  }

  private async _defaultClassProvider<T extends new (...args: any[]) => any>(type: T): Promise<InstanceType<T>> {

    if (!this.hasInStore(type)) {


      const info = getClassInjectionInformation(type);
      const constructParametersInfo = getClassConstructorParams(type);
      const constructParams = [];

      if (constructParametersInfo.length > 0) {
        for (let idx = 0; idx < constructParametersInfo.length; idx++) {
          const paramInfo = constructParametersInfo[idx];
          constructParams[paramInfo.parameterIndex] = await this.getInstance(paramInfo.type);
        }
      }

      const inst = new type(...constructParams);
      this.setStore(type, inst);

      if (info.size > 0) {
        const keys = info.keys();
        for (const key of keys) {
          const prop = info.get(key);
          if (prop.injectType == 'classProperty') {
            inst[key] = await this.getInstance(prop.type);
          }
        }
      }

    }

    return this.getStore(type);
  }

  private _getProviderParams(provider) {
    const type = provider.constructor;
    return getClassMethodParams(type, 'provide');
  }

  private _getClassParams(clazz) {
    return getClassConstructorParams(clazz);
  }

  private _checkDependency(root: any) {

    const g = new Graph({ directed: true });
    const m = new Map();
    let idx = 0;

    const getTypeName = (t) => typeof t == 'function' ? (t.name || getOrDefault(m, t, `Unknown${idx++}`)) : t;

    const lookupDependencies = (t: any) => {

      const typeName = getTypeName(t);
      let params: InjectParameter[] = [];

      if (this.hasInProviders(t)) {
        params = this._getProviderParams(this.getProvider(t));
      } else if (typeof t == 'function') {
        params = this._getClassParams(t);
      }

      if (params.length > 0) {

        params.forEach(({ type }) => {
          // type, maybe an identifier or a function

          if (type instanceof LazyRef) {
            type = type.getRef();
          }

          const paramName = getTypeName(type);

          g.setEdge(typeName, paramName);

          const cycles = alg.findCycles(g);
          if (cycles.length > 0) {
            throw new TypeError(`found cycle dependencies in: ${cycles.map((cycle) => cycle.join(', ')).join('| ')}`);
          }

          lookupDependencies(type);

        });

      }
    };

    try {
      lookupDependencies(root);
    } finally {
      m.clear();
    }


    return;
  }


}


export class SubLevelInjectContainer extends InjectContainer {

  private _global: InjectContainer;

  constructor(@inject(InjectContainer) globalContainer: InjectContainer) {
    super();
    this._global = globalContainer;
  }

  hasInStore(type) {
    // @ts-ignore
    return super.hasInStore(type) || this._global.hasInStore(type);
  }

  getStore(type) {
    if (this.hasInStore(type)) {
      if (super.hasInStore(type)) {
        return super.getStore(type);
      }
      // @ts-ignore
      return this._global.getStore(type);
    }
    return undefined;
  }

  hasInProviders(type) {
    // @ts-ignore
    return super.hasInProviders(type) || this._global.hasInProviders(type);
  }

  getProvider(type) {
    if (this.hasInProviders(type)) {
      if (super.hasInProviders(type)) {
        return super.getProvider(type);
      }
      // @ts-ignore
      return this._global.getProvider(type);
    }
    return undefined;
  }


}

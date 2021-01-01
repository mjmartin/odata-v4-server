import { InjectContainer } from '@newdash/inject';
import { Edm as Metadata, ServiceDocument, ServiceMetadata } from '@odata/metadata';
import { defaultParser } from '@odata/parser';
import { Token } from '@odata/parser/lib/lexer';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as http from 'http';
import { Readable, Writable } from 'stream';
import * as swaggerUi from 'swagger-ui-express';
import { InjectKey, ServerType } from './constants';
import { ODataController } from './controller';
import { ContainerBase } from './edm';
import { createMetadataJSON } from './metadata';
import { ensureODataHeaders, withODataBatchRequestHandler, withODataErrorHandler, withODataHeader, withODataRequestHandler, withODataVersionVerify, withSwaggerDocument } from './middlewares';
import * as odata from './odata';
// eslint-disable-next-line no-duplicate-imports
import { IODataConnector, ODataBase } from './odata';
import { ODataMetadataType, ODataProcessor, ODataProcessorOptions } from './processor';
import { ODataResult } from './result';
import { commitTransaction, createTransactionContext, rollbackTransaction, TransactionConnectionProvider, TransactionContext, TransactionQueryRunnerProvider } from './transaction';
import { ODataServiceProvider } from './type';


/** HTTP context interface when using the server HTTP request handler */
export interface ODataHttpContext {
  url: string
  method: string
  protocol: 'http' | 'https'
  host: string
  base: string
  request: express.Request & Readable
  response: express.Response & Writable
  tx?: TransactionContext
}


/**
 * ODataServer base class to be extended by concrete OData Server data sources
 **/
export class ODataServerBase {

  public static variant = ServerType.base

  private static _metadataCache: any
  static namespace: string
  static container = new ContainerBase();
  static parser = defaultParser;
  static connector: IODataConnector
  static validator: (odataQuery: string | Token) => null;
  static errorHandler: express.ErrorRequestHandler = withODataErrorHandler;

  static async execute<T>(url: string, body?: object): Promise<ODataResult<T>>;
  static async execute<T>(url: string, method?: string, body?: object): Promise<ODataResult<T>>;
  static async execute<T>(context: object, body?: object): Promise<ODataResult<T>>;
  static async execute<T>(url: string | object, method?: string | object, body?: object): Promise<ODataResult<T>> {

    // format context
    let context: any = {};
    if (typeof url == 'object') {
      context = Object.assign(context, url);
      if (typeof method == 'object') {
        body = method;
      }
      url = undefined;
      method = undefined;
    } else if (typeof url == 'string') {
      context.url = url;
      if (typeof method == 'object') {
        body = method;
        method = 'POST';
      }
      context.method = method || 'GET';
    }
    context.method = context.method || 'GET';
    context.request = context.request || body;

    const txContext = createTransactionContext();

    try {

      const processor = await this.createProcessor(context, <ODataProcessorOptions>{
        objectMode: true,
        metadata: context.metadata || ODataMetadataType.minimal
      });

      const values = [];

      let flushObject;
      let response = '';

      if (context.response instanceof Writable) {
        processor.pipe(context.response);
      }

      processor.on('data', (chunk: any) => {
        if (!(typeof chunk == 'string' || chunk instanceof Buffer)) {
          if (chunk['@odata.context'] && chunk.value && Array.isArray(chunk.value) && chunk.value.length == 0) {
            flushObject = chunk;
            flushObject.value = values;
          } else {
            values.push(chunk);
          }
        } else {
          response += chunk.toString();
        }
      });

      // @ts-ignore
      const result: ODataResult<T> = await processor.execute(context.body || body);

      if (flushObject) {
        result.body = flushObject;
        if (!result.elementType || typeof result.elementType == 'object') {
          result.elementType = flushObject.elementType;
        }
        delete flushObject.elementType;
        result.contentType = result.contentType || 'application/json';
      } else if (result && response) {
        result.body = <any>response;
      }
      await commitTransaction(txContext);
      return result;
    } catch (error) {
      await rollbackTransaction(txContext);
      throw error;
    }

  }

  private static _injectContainer: InjectContainer;

  static getInjectContainer() {
    if (this._injectContainer == undefined) {

      this._injectContainer = InjectContainer.New();
      this._injectContainer.registerInstance(InjectKey.ServerType, this);

      this._injectContainer.registerProvider(TransactionQueryRunnerProvider);
      this._injectContainer.registerProvider(TransactionConnectionProvider);
      this._injectContainer.registerProvider(ODataServiceProvider);

      this._injectContainer.doNotWrap(
        InjectKey.ServerType,
        InjectKey.TransactionQueryRunner,
        InjectKey.TransactionConnection,
        InjectKey.ProcessorOption,
        InjectKey.RequestContext,
        InjectKey.Response,
        InjectKey.ODataBodyParameter,
        InjectKey.ODataQueryParameter,
        InjectKey.GlobalConnection,
        InjectKey.ODataTypeParameter,
        InjectKey.DatabaseHelper
      );

    }
    return this._injectContainer;
  }

  static async createProcessor(context: any, options?: ODataProcessorOptions) {
    const requestContainer = await this.getInjectContainer().createSubContainer();
    requestContainer.registerInstance(InjectKey.RequestContext, context);
    requestContainer.registerInstance(InjectKey.ProcessorOption, options);
    return requestContainer.getInstance(ODataProcessor);
  }

  static $metadata(): ServiceMetadata;
  static $metadata(metadata: Metadata.Edmx | any);
  static $metadata(metadata?): ServiceMetadata {
    if (metadata) {
      if (!(metadata instanceof Metadata.Edmx)) {
        if (metadata.version && metadata.dataServices && Array.isArray(metadata.dataServices.schema)) {
          this._metadataCache = ServiceMetadata.processMetadataJson(metadata);
        } else {
          this._metadataCache = ServiceMetadata.defineEntities(metadata);
        }
      }
    }
    return this._metadataCache || (this._metadataCache = ServiceMetadata.processMetadataJson(createMetadataJSON(this)));
  }

  static document(): ServiceDocument {
    return ServiceDocument.processEdmx(this.$metadata().edmx);
  }

  protected static addController(controller: typeof ODataController, isPublic?: boolean);
  protected static addController(controller: typeof ODataController, isPublic?: boolean, elementType?: Function);
  protected static addController(controller: typeof ODataController, entitySetName?: string, elementType?: Function);
  protected static addController(controller: typeof ODataController, entitySetName?: string | boolean, elementType?: Function) {
    odata.controller(controller, <string>entitySetName, elementType)(this);
  }

  protected static getController(elementType: Function) {
    for (const i in this.prototype) {
      const prop = this.prototype[i];
      if (prop?.prototype instanceof ODataController && prop?.prototype?.elementType == elementType) {
        return prop;
      }
    }
    return null;
  }

  public static create(): express.Router;
  public static create(port: number): http.Server;
  public static create(path: string, port: number): http.Server;
  public static create(port: number, hostname: string): http.Server;
  public static create(path?: string | RegExp | number, port?: number | string, hostname?: string): http.Server;
  public static create(path?: string | RegExp | number, port?: number | string, hostname?: string): http.Server | express.Router {
    const server = this;
    const router = express.Router();

    router.use(withODataVersionVerify);

    router.use(bodyParser.json());

    if ((<any>server).cors) {
      router.use(cors());
    }


    router.use(withODataHeader);

    router.get('/', ensureODataHeaders, server.document().requestHandler());

    router.get('/\\$metadata', server.$metadata().requestHandler());

    // enable swagger ui
    router.use('/api-docs', withSwaggerDocument(server.$metadata()), swaggerUi.serve, swaggerUi.setup());

    // $batch request handler
    router.post('/\\$batch', withODataBatchRequestHandler(this));

    // simple single request handler
    router.use(withODataRequestHandler(this));

    router.use(withODataErrorHandler);

    if (typeof path == 'number') {
      if (typeof port == 'string') {
        hostname = `${port}`;
      }
      port = parseInt(path as any, 10);
      path = undefined;
    }
    if (typeof port == 'number') {
      const app = express();
      app.use((path as any) ?? '/', router);
      return app.listen(port, hostname);
    }
    return router;
  }


  protected static async getControllerInstance(controllerOrEntityType: any): Promise<ODataController> {

    const ic = await this._injectContainer.createSubContainer();

    if (controllerOrEntityType == undefined) {
      throw new Error('must provide the controller type');
    }

    let serviceType: any = undefined;
    if (controllerOrEntityType.prototype instanceof ODataController) {
      // if controller
      serviceType = controllerOrEntityType;
    } else {
      // if entity
      ic.registerInstance(InjectKey.ODataTypeParameter, controllerOrEntityType);
      serviceType = this.getController(controllerOrEntityType);
    }

    if (serviceType == undefined) {
      throw new TypeError(`${controllerOrEntityType?.name} is not a controller or entity type.`);
    }

    return ic.getInstance(serviceType as ODataController);
  }

}

export class ODataServer extends ODataBase<ODataServerBase, typeof ODataServerBase>(ODataServerBase) {

}

/**
 * Create Express server for OData Server
 * @param server OData Server instance
 * @return Express Router object
 */
export function createODataServer(server: typeof ODataServer): express.Router;

/** Create Express server for OData Server
 * @param server OData Server instance
 * @param port   port number for Express to listen to
 */
export function createODataServer(server: typeof ODataServer, port: number): http.Server;

/** Create Express server for OData Server
 * @param server OData Server instance
 * @param path   routing path for Express
 * @param port   port number for Express to listen to
 */
export function createODataServer(server: typeof ODataServer, path: string, port: number): http.Server;

/** Create Express server for OData Server
 * @param server   OData Server instance
 * @param port     port number for Express to listen to
 * @param hostname hostname for Express
 */
export function createODataServer(server: typeof ODataServer, port: number, hostname: string): http.Server;

/** Create Express server for OData Server
 * @param server   OData Server instance
 * @param path     routing path for Express
 * @param port     port number for Express to listen to
 * @param hostname hostname for Express
 * @return         Express Router object
 */
export function createODataServer(server: typeof ODataServer, path?: string | RegExp | number, port?: number | string, hostname?: string): http.Server | express.Router {
  return server.create(path, port, hostname);
}

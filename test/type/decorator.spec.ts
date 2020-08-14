import { BaseODataModel, createPropertyDecorator, getPropertyOptions, KeyProperty, ODataEntityType, OptionalProperty, Property, UUIDKeyProperty } from '../../src';
import { shutdown } from '../utils/server';
import { createServerAndClient } from './utils';


describe('Decorator Test Suite', () => {

  it('should create custom decorators', () => {

    const OptionalProperty = createPropertyDecorator({ nullable: true });

    @ODataEntityType()
    class D1 extends BaseODataModel {

      @KeyProperty({ generated: 'increment' })
      key: number;

      @OptionalProperty()
      c1: number;

      @Property()
      c2: number;

    }

    expect(getPropertyOptions(D1, 'key').primary).toBeTruthy();
    expect(getPropertyOptions(D1, 'c1').nullable).toBeTruthy();
    expect(getPropertyOptions(D1, 'c2').nullable).toBeFalsy();

  });

  it('should support custom the database name for property', async () => {

    @ODataEntityType()
    class D2 extends BaseODataModel {

      @UUIDKeyProperty()
      key: number;

      // define property name in database
      @OptionalProperty({ name: 'cc2' })
      c1: number;

    }

    const { server, client } = await createServerAndClient({
      name: 'decorator_test_conn_',
      entityPrefix: 'decorator_test_02_',
      entities: [D2]
    }, D2);

    try {
      const es = client.getEntitySet<D2>('D2s');
      await es.create({ c1: 123 });
      await es.query(client.newParam().select('c1')); // please no error here
    } finally {
      await shutdown(server);
    }


  });


});
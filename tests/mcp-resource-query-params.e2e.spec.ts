import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { McpModule } from '../src/mcp/mcp.module';
import { createSseClient } from './utils';
import { ResourceTemplate } from '../src';

@Injectable()
export class QueryParamResource {
  @ResourceTemplate({
    name: 'pizza-carousel',
    description: 'A pizza carousel that can be filtered by topping',
    mimeType: 'application/json',
    uriTemplate: 'ui://widget/pizza-carousel{?pizzaTopping}',
  })
  async getPizzaCarousel({
    uri,
    pizzaTopping,
  }: {
    uri: string;
    pizzaTopping?: string;
  }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            widget: 'carousel',
            filter: pizzaTopping || 'all',
          }),
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'pizza-list-multi',
    description: 'A pizza list with multiple query parameters',
    mimeType: 'application/json',
    uriTemplate: 'ui://widget/pizza-list{?topping,size}',
  })
  async getPizzaListMulti({
    uri,
    topping,
    size,
  }: {
    uri: string;
    topping?: string;
    size?: string;
  }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            widget: 'list',
            filter: {
              topping: topping || 'all',
              size: size || 'any',
            },
          }),
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'pizza-mixed',
    description: 'A resource with both path and query parameters',
    mimeType: 'application/json',
    uriTemplate: 'ui://widget/pizza/{category}{?topping}',
  })
  async getPizzaMixed({
    uri,
    category,
    topping,
  }: {
    uri: string;
    category: string;
    topping?: string;
  }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            widget: 'mixed',
            category,
            filter: topping || 'all',
          }),
        },
      ],
    };
  }
}

describe('E2E: MCP Resource Template Query Parameters (RFC 6570)', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'query-param-server',
          version: '1.0.0',
        }),
      ],
      providers: [QueryParamResource],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Single query parameter {?param}', () => {
    it('should list resource templates with query parameter syntax', async () => {
      const client = await createSseClient(testPort);
      try {
        const resourceTemplates = await client.listResourceTemplates();

        const pizzaCarousel = resourceTemplates.resourceTemplates.find(
          (r) => r.name === 'pizza-carousel',
        );
        expect(pizzaCarousel).toBeDefined();
        expect(pizzaCarousel?.uriTemplate).toBe(
          'ui://widget/pizza-carousel{?pizzaTopping}',
        );
      } finally {
        await client.close();
      }
    });

    it('should read resource with query parameter', async () => {
      const client = await createSseClient(testPort);
      try {
        const resource = await client.readResource({
          uri: 'ui://widget/pizza-carousel?pizzaTopping=pepperoni',
        });

        expect(resource.contents).toHaveLength(1);
        const content = JSON.parse((resource.contents[0] as any).text as string);
        expect(content.widget).toBe('carousel');
        expect(content.filter).toBe('pepperoni');
      } finally {
        await client.close();
      }
    });

    it('should read resource without query parameter', async () => {
      const client = await createSseClient(testPort);
      try {
        const resource = await client.readResource({
          uri: 'ui://widget/pizza-carousel',
        });

        expect(resource.contents).toHaveLength(1);
        const content = JSON.parse((resource.contents[0] as any).text as string);
        expect(content.widget).toBe('carousel');
        expect(content.filter).toBe('all');
      } finally {
        await client.close();
      }
    });
  });

  describe('Multiple query parameters {?param1,param2}', () => {
    it('should list resource templates with multiple query parameters', async () => {
      const client = await createSseClient(testPort);
      try {
        const resourceTemplates = await client.listResourceTemplates();

        const pizzaList = resourceTemplates.resourceTemplates.find(
          (r) => r.name === 'pizza-list-multi',
        );
        expect(pizzaList).toBeDefined();
        expect(pizzaList?.uriTemplate).toBe(
          'ui://widget/pizza-list{?topping,size}',
        );
      } finally {
        await client.close();
      }
    });

    it('should read resource with multiple query parameters', async () => {
      const client = await createSseClient(testPort);
      try {
        const resource = await client.readResource({
          uri: 'ui://widget/pizza-list?topping=mushroom&size=large',
        });

        expect(resource.contents).toHaveLength(1);
        const content = JSON.parse((resource.contents[0] as any).text as string);
        expect(content.widget).toBe('list');
        expect(content.filter.topping).toBe('mushroom');
        expect(content.filter.size).toBe('large');
      } finally {
        await client.close();
      }
    });

    it('should read resource with partial query parameters', async () => {
      const client = await createSseClient(testPort);
      try {
        const resource = await client.readResource({
          uri: 'ui://widget/pizza-list?topping=pepperoni',
        });

        expect(resource.contents).toHaveLength(1);
        const content = JSON.parse((resource.contents[0] as any).text as string);
        expect(content.widget).toBe('list');
        expect(content.filter.topping).toBe('pepperoni');
        expect(content.filter.size).toBe('any');
      } finally {
        await client.close();
      }
    });
  });

  describe('Mixed path and query parameters', () => {
    it('should list resource templates with mixed parameters', async () => {
      const client = await createSseClient(testPort);
      try {
        const resourceTemplates = await client.listResourceTemplates();

        const pizzaMixed = resourceTemplates.resourceTemplates.find(
          (r) => r.name === 'pizza-mixed',
        );
        expect(pizzaMixed).toBeDefined();
        expect(pizzaMixed?.uriTemplate).toBe(
          'ui://widget/pizza/{category}{?topping}',
        );
      } finally {
        await client.close();
      }
    });

    it('should read resource with path and query parameters', async () => {
      const client = await createSseClient(testPort);
      try {
        const resource = await client.readResource({
          uri: 'ui://widget/pizza/vegetarian?topping=olives',
        });

        expect(resource.contents).toHaveLength(1);
        const content = JSON.parse((resource.contents[0] as any).text as string);
        expect(content.widget).toBe('mixed');
        expect(content.category).toBe('vegetarian');
        expect(content.filter).toBe('olives');
      } finally {
        await client.close();
      }
    });

    it('should read resource with path parameter only', async () => {
      const client = await createSseClient(testPort);
      try {
        const resource = await client.readResource({
          uri: 'ui://widget/pizza/meat-lovers',
        });

        expect(resource.contents).toHaveLength(1);
        const content = JSON.parse((resource.contents[0] as any).text as string);
        expect(content.widget).toBe('mixed');
        expect(content.category).toBe('meat-lovers');
        expect(content.filter).toBe('all');
      } finally {
        await client.close();
      }
    });
  });
});

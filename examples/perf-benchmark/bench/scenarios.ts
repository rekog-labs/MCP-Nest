import { ScenarioSpec, ServerId } from './types';

const STATELESS_SERVERS: ServerId[] = [
  'v2-stateless',
  'raw-sdk-stateless',
  'raw-sdk-nest',
  'v1-stateless',
];

function echoCallBody(text: string) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'echo',
      arguments: { text },
    },
  };
}

function toolsListBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  };
}

export const SCENARIOS: ScenarioSpec[] = [
  {
    id: 'S1-echo',
    description: 'tools/call echo {text: "hello"} against stateless servers',
    method: 'tools/call',
    bodyFactory: () => echoCallBody('hello'),
    servers: STATELESS_SERVERS,
    driver: 'autocannon',
  },
  {
    id: 'S2-list-n5',
    description: 'tools/list with TOOL_COUNT=5',
    method: 'tools/list',
    bodyFactory: () => toolsListBody(),
    toolCountOverride: 5,
    servers: STATELESS_SERVERS,
    driver: 'autocannon',
  },
  {
    id: 'S2-list-n50',
    description: 'tools/list with TOOL_COUNT=50 (default)',
    method: 'tools/list',
    bodyFactory: () => toolsListBody(),
    servers: STATELESS_SERVERS,
    driver: 'autocannon',
  },
  {
    id: 'S3-payload-10kb',
    description: 'tools/call echo with a 10KB text payload',
    method: 'tools/call',
    bodyFactory: () => echoCallBody('x'.repeat(10 * 1024)),
    servers: STATELESS_SERVERS,
    driver: 'autocannon',
  },
  {
    id: 'S3-payload-100kb',
    description: 'tools/call echo with a 100KB text payload',
    method: 'tools/call',
    bodyFactory: () => echoCallBody('x'.repeat(100 * 1024)),
    servers: STATELESS_SERVERS,
    driver: 'autocannon',
  },
  {
    id: 'S4-stateful-echo',
    description:
      'tools/call echo {text: "hello"} against the stateful v2 server via persistent SDK client sessions',
    method: 'tools/call',
    bodyFactory: () => echoCallBody('hello'),
    servers: ['v2-stateful'],
    driver: 'sdk-client-loop',
  },
];

export const CONCURRENCIES = [1, 10, 100];
export const WARMUP_SEC = 5;
export const DURATION_SEC = 15;

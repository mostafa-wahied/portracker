'use strict';

const { describe, expect, test } = require('@jest/globals');
const { parseDockerGateway, detectDockerGateway } = require('./http-gateway');

const header = 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT';
const route = (gateway, metric = 0, flags = '0003', destination = '00000000',
  mask = '00000000') => 'eth0 ' +
  [destination, gateway, flags, '0', '0', String(metric), mask, '0', '0', '0'].join(' ');

describe('safe Docker bridge gateway selection', () => {
  test('reads little-endian default route, prioritizes smallest metric', () => {
    expect(parseDockerGateway([header, route('010011AC', 100),
      route('010012AC', 5)].join('\n'))).toBe('172.18.0.1');
    expect(parseDockerGateway([header, route('010011AC')].join('\n')))
      .toBe('172.17.0.1');
  });

  test('does not guess routes, ignore up/down flags or ambiguously tied metrics', () => {
    expect(parseDockerGateway('')).toBeNull();
    expect(parseDockerGateway([header, route('010011AC', 0, '0001')].join('\n')))
      .toBeNull();
    expect(parseDockerGateway([header, route('010011AC', 0),
      route('010012AC', 0)].join('\n'))).toBeNull();
    expect(parseDockerGateway([header, route('010011AC', 0, '0003', '0001A8C0')]
      .join('\n'))).toBeNull();
    expect(parseDockerGateway([header, route('010011AC', 0, '0003', '00000000',
      '00FFFFFF')].join('\n'))).toBeNull();
    expect(parseDockerGateway([header, 'eth0 00000000 GARBAGE 0003 0 0 0 00000000 0 0 0']
      .join('\n'))).toBeNull();
  });

  test('missing or denied route table is a nonfatal unavailable capability', () => {
    expect(detectDockerGateway({ readFile: () => { throw new Error('EACCES'); } }))
      .toBeNull();
    expect(detectDockerGateway({ readFile: () => header + '\n' +
      route('010011AC') })).toBe('172.17.0.1');
  });
});

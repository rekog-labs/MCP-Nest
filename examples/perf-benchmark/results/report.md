# Benchmark Report

Generated: 2026-07-03T06:57:36.711Z

## Environment

- Node: v22.22.1
- Platform: linux/x64
- CPU: AMD Ryzen 9 7950X 16-Core Processor x32
- @rekog/mcp-nest v2: 2.0.0-alpha.4
- @rekog/mcp-nest v1: 1.9.10

## Smoke Check

| Server | Supports Bare Call | Driver Used | Note |
| --- | --- | --- | --- |
| v2-stateless | true | autocannon |  |
| v2-stateful | false | sdk-client-loop | expected: stateful server rejects bare calls without a session (HTTP 400: {"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Mcp-Session-Id header is required"},"id":null}) |
| raw-sdk-stateless | true | autocannon |  |
| raw-sdk-nest | true | autocannon |  |
| v1-stateless | true | autocannon |  |

## Scenario Results

### S1-echo (c=1)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2786.2 | 0.0 | 1.0 | 122.1 | 421.0 | 0 | 0 |
| raw-sdk-stateless | autocannon | 3783.5 | 0.0 | 1.0 | 120.9 | 376.4 | 0 | 0 |
| raw-sdk-nest | autocannon | 2964.1 | 0.0 | 1.0 | 120.3 | 426.4 | 0 | 0 |
| v1-stateless | autocannon | 2449.3 | 0.0 | 1.0 | 120.6 | 443.5 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -26.4% | +0.0% | yes |
| v2-stateless vs raw-sdk-nest | -6.0% | +0.0% | yes |
| v2-stateless vs v1-stateless | +13.8% | +0.0% | yes |

### S1-echo (c=10)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2871.0 | 3.0 | 5.0 | 122.5 | 421.9 | 0 | 0 |
| raw-sdk-stateless | autocannon | 3960.6 | 2.0 | 4.0 | 121.1 | 377.9 | 0 | 0 |
| raw-sdk-nest | autocannon | 3100.2 | 3.0 | 4.0 | 120.9 | 419.1 | 0 | 0 |
| v1-stateless | autocannon | 2481.3 | 3.0 | 6.0 | 120.7 | 443.8 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -27.5% | +25.0% | yes |
| v2-stateless vs raw-sdk-nest | -7.4% | +25.0% | yes |
| v2-stateless vs v1-stateless | +15.7% | -16.7% | yes |

### S1-echo (c=100)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2777.8 | 35.0 | 48.0 | 122.8 | 475.9 | 0 | 0 |
| raw-sdk-stateless | autocannon | 3729.8 | 26.0 | 38.0 | 123.6 | 413.2 | 0 | 0 |
| raw-sdk-nest | autocannon | 2904.5 | 33.0 | 46.0 | 122.4 | 469.3 | 0 | 0 |
| v1-stateless | autocannon | 2456.9 | 40.0 | 53.0 | 120.5 | 501.0 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -25.5% | +26.3% | yes |
| v2-stateless vs raw-sdk-nest | -4.4% | +4.3% | yes |
| v2-stateless vs v1-stateless | +13.1% | -9.4% | yes |

### S2-list-n50 (c=1)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 562.1 | 1.0 | 2.0 | 107.5 | 421.6 | 0 | 0 |
| raw-sdk-stateless | autocannon | 618.8 | 1.0 | 2.0 | 105.9 | 330.8 | 0 | 0 |
| raw-sdk-nest | autocannon | 539.7 | 1.0 | 2.0 | 108.0 | 336.7 | 0 | 0 |
| v1-stateless | autocannon | 537.5 | 1.0 | 2.0 | 109.2 | 450.3 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -9.2% | +0.0% | yes |
| v2-stateless vs raw-sdk-nest | +4.2% | +0.0% | yes |
| v2-stateless vs v1-stateless | +4.6% | +0.0% | yes |

### S2-list-n50 (c=10)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 582.1 | 16.0 | 25.0 | 106.4 | 426.8 | 0 | 0 |
| raw-sdk-stateless | autocannon | 620.9 | 15.0 | 30.0 | 106.3 | 391.1 | 0 | 0 |
| raw-sdk-nest | autocannon | 556.6 | 17.0 | 26.0 | 106.8 | 424.7 | 0 | 0 |
| v1-stateless | autocannon | 547.6 | 17.0 | 26.0 | 105.4 | 452.8 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -6.2% | -16.7% | yes |
| v2-stateless vs raw-sdk-nest | +4.6% | -3.8% | yes |
| v2-stateless vs v1-stateless | +6.3% | -3.8% | yes |

### S2-list-n50 (c=100)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 572.2 | 158.0 | 377.0 | 105.1 | 449.1 | 0 | 0 |
| raw-sdk-stateless | autocannon | 616.3 | 154.0 | 217.0 | 105.1 | 398.6 | 0 | 0 |
| raw-sdk-nest | autocannon | 556.9 | 159.0 | 431.0 | 104.7 | 445.7 | 0 | 0 |
| v1-stateless | autocannon | 548.5 | 164.0 | 481.0 | 105.3 | 466.0 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -7.1% | +73.7% | yes |
| v2-stateless vs raw-sdk-nest | +2.8% | -12.5% | yes |
| v2-stateless vs v1-stateless | +4.3% | -21.6% | yes |

### S2-list-n5 (c=1)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2016.1 | 0.0 | 1.0 | 113.9 | 395.6 | 0 | 0 |
| raw-sdk-stateless | autocannon | 2508.7 | 0.0 | 1.0 | 110.4 | 354.4 | 0 | 0 |
| raw-sdk-nest | autocannon | 2049.9 | 0.0 | 1.0 | 112.2 | 390.4 | 0 | 0 |
| v1-stateless | autocannon | 1820.3 | 0.0 | 1.0 | 113.5 | 415.4 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -19.6% | +0.0% | yes |
| v2-stateless vs raw-sdk-nest | -1.6% | +0.0% | yes |
| v2-stateless vs v1-stateless | +10.8% | +0.0% | yes |

### S2-list-n5 (c=10)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2046.5 | 4.0 | 6.0 | 114.3 | 402.6 | 0 | 0 |
| raw-sdk-stateless | autocannon | 2597.1 | 3.0 | 6.0 | 111.0 | 360.5 | 0 | 0 |
| raw-sdk-nest | autocannon | 2091.3 | 4.0 | 6.0 | 112.1 | 393.4 | 0 | 0 |
| v1-stateless | autocannon | 1798.9 | 5.0 | 7.0 | 112.4 | 423.2 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -21.2% | +0.0% | yes |
| v2-stateless vs raw-sdk-nest | -2.1% | +0.0% | yes |
| v2-stateless vs v1-stateless | +13.8% | -14.3% | yes |

### S2-list-n5 (c=100)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 1985.8 | 49.0 | 65.0 | 115.4 | 454.9 | 0 | 0 |
| raw-sdk-stateless | autocannon | 2498.9 | 39.0 | 54.0 | 112.7 | 410.5 | 0 | 0 |
| raw-sdk-nest | autocannon | 1999.9 | 48.0 | 65.0 | 113.9 | 434.4 | 0 | 0 |
| v1-stateless | autocannon | 1821.2 | 54.0 | 68.0 | 112.5 | 469.5 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -20.5% | +20.4% | yes |
| v2-stateless vs raw-sdk-nest | -0.7% | +0.0% | yes |
| v2-stateless vs v1-stateless | +9.0% | -4.4% | yes |

### S3-payload-100kb (c=1)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 1420.7 | 0.0 | 1.0 | 126.2 | 463.3 | 0 | 0 |
| raw-sdk-stateless | autocannon | 1698.0 | 0.0 | 1.0 | 116.6 | 424.5 | 0 | 0 |
| raw-sdk-nest | autocannon | 1522.0 | 0.0 | 1.0 | 118.3 | 450.2 | 0 | 0 |
| v1-stateless ⚠️ | autocannon | 5112.4 | 0.0 | 0.0 | 104.3 | 425.9 | 0 | 76678 |

> ⚠️ = the flagged server returned mostly non-2xx (error) responses for this cell, so its req/s reflects fast rejections, NOT completed tool calls — not comparable.

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -16.3% | +0.0% | yes |
| v2-stateless vs raw-sdk-nest | -6.7% | +0.0% | yes |
| v2-stateless vs v1-stateless | -72.2% | n/a | yes |

### S3-payload-100kb (c=10)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 1427.2 | 6.0 | 12.0 | 126.0 | 558.1 | 0 | 0 |
| raw-sdk-stateless | autocannon | 1719.5 | 5.0 | 11.0 | 120.2 | 475.3 | 0 | 0 |
| raw-sdk-nest | autocannon | 1494.1 | 6.0 | 12.0 | 119.0 | 510.4 | 0 | 0 |
| v1-stateless ⚠️ | autocannon | 5400.1 | 1.0 | 3.0 | 107.6 | 429.8 | 0 | 80994 |

> ⚠️ = the flagged server returned mostly non-2xx (error) responses for this cell, so its req/s reflects fast rejections, NOT completed tool calls — not comparable.

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -17.0% | +9.1% | yes |
| v2-stateless vs raw-sdk-nest | -4.5% | +0.0% | yes |
| v2-stateless vs v1-stateless | -73.6% | +300.0% | yes |

### S3-payload-100kb (c=100)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 1394.3 | 70.0 | 81.0 | 124.7 | 717.6 | 0 | 0 |
| raw-sdk-stateless | autocannon | 1623.9 | 60.0 | 70.0 | 122.1 | 688.3 | 0 | 0 |
| raw-sdk-nest | autocannon | 1433.7 | 68.0 | 78.0 | 121.9 | 685.1 | 0 | 0 |
| v1-stateless ⚠️ | autocannon | 5113.2 | 18.0 | 24.0 | 107.3 | 452.3 | 0 | 76689 |

> ⚠️ = the flagged server returned mostly non-2xx (error) responses for this cell, so its req/s reflects fast rejections, NOT completed tool calls — not comparable.

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -14.1% | +15.7% | yes |
| v2-stateless vs raw-sdk-nest | -2.7% | +3.8% | yes |
| v2-stateless vs v1-stateless | -72.7% | +237.5% | yes |

### S3-payload-10kb (c=1)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2596.9 | 0.0 | 1.0 | 122.5 | 434.1 | 0 | 0 |
| raw-sdk-stateless | autocannon | 3363.3 | 0.0 | 1.0 | 119.5 | 386.1 | 0 | 0 |
| raw-sdk-nest | autocannon | 2619.7 | 0.0 | 1.0 | 119.2 | 427.3 | 0 | 0 |
| v1-stateless | autocannon | 2194.2 | 0.0 | 1.0 | 118.2 | 446.5 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -22.8% | +0.0% | yes |
| v2-stateless vs raw-sdk-nest | -0.9% | +0.0% | yes |
| v2-stateless vs v1-stateless | +18.4% | +0.0% | yes |

### S3-payload-10kb (c=10)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2655.9 | 3.0 | 6.0 | 123.7 | 428.4 | 0 | 0 |
| raw-sdk-stateless | autocannon | 3549.0 | 2.0 | 4.0 | 122.4 | 386.8 | 0 | 0 |
| raw-sdk-nest | autocannon | 2734.9 | 3.0 | 6.0 | 120.4 | 423.0 | 0 | 0 |
| v1-stateless | autocannon | 2222.5 | 4.0 | 6.0 | 119.6 | 446.7 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -25.2% | +50.0% | yes |
| v2-stateless vs raw-sdk-nest | -2.9% | +0.0% | yes |
| v2-stateless vs v1-stateless | +19.5% | +0.0% | yes |

### S3-payload-10kb (c=100)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateless | autocannon | 2538.6 | 38.0 | 52.0 | 124.9 | 502.9 | 0 | 0 |
| raw-sdk-stateless | autocannon | 3344.6 | 29.0 | 41.0 | 124.8 | 453.3 | 0 | 0 |
| raw-sdk-nest | autocannon | 2578.1 | 37.0 | 50.0 | 121.5 | 495.0 | 0 | 0 |
| v1-stateless | autocannon | 2210.1 | 44.0 | 56.0 | 119.5 | 501.7 | 0 | 0 |

**Deltas (v2-stateless vs baseline)**

| Comparison | Req/s delta | p99 delta | Comparable? |
| --- | --- | --- | --- |
| v2-stateless vs raw-sdk-stateless | -24.1% | +26.8% | yes |
| v2-stateless vs raw-sdk-nest | -1.5% | +4.0% | yes |
| v2-stateless vs v1-stateless | +14.9% | -7.1% | yes |

### S4-stateful-echo (c=1)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateful | sdk-client-loop | 2079.6 | 0.4 | 1.5 | 75.7 | 419.9 | 0 | 0 |

### S4-stateful-echo (c=10)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateful | sdk-client-loop | 3633.8 | 2.3 | 5.9 | 120.8 | 426.0 | 0 | 0 |

### S4-stateful-echo (c=100)

| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-stateful | sdk-client-loop | 3529.5 | 26.9 | 53.8 | 122.2 | 486.8 | 0 | 0 |

const axios = require('axios');

const CONCURRENCY = 10000;
const URL = 'http://localhost:3002/openadr/v3/events';

async function sendEvent(id) {
  const payload = {
    id: `event-${id}-${Date.now()}`,
    type: 'demand-response',
    signals: [{ type: 'level', value: 1 }],
    targets: [{ type: 'fleet', id: 'fleet-001' }],
    intervals: [{ start: new Date().toISOString(), duration: 'PT1H' }]
  };

  try {
    const start = Date.now();
    await axios.post(URL, payload);
    return Date.now() - start;
  } catch (error) {
    return { error: error.message };
  }
}

async function runTest() {
  console.log(`🚀 Starting load test: ${CONCURRENCY} concurrent payloads...`);

  const startTime = Date.now();
  const promises = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    promises.push(sendEvent(i));
  }

  const results = await Promise.all(promises);
  const endTime = Date.now();

  const latencies = results.filter(r => typeof r === 'number');
  const errors = results.filter(r => typeof r !== 'number');

  const totalTime = endTime - startTime;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLatency = Math.max(...latencies);
  const minLatency = Math.min(...latencies);

  console.log('\n--- Load Test Results ---');
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Total requests: ${CONCURRENCY}`);
  console.log(`Successes: ${latencies.length}`);
  console.log(`Errors: ${errors.length}`);
  if (latencies.length > 0) {
    console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`Min Latency: ${minLatency}ms`);
    console.log(`Max Latency: ${maxLatency}ms`);
    console.log(`Throughput: ${(latencies.length / (totalTime / 1000)).toFixed(2)} req/sec`);
  }
}

runTest();

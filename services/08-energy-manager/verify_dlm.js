const { calculateAllocations } = require('./src/dlm/allocator');
const { DateTime } = require('luxon');

const mockSiteLimitKw = 100;
const mockBuildingLoadKw = 20;

const mockActiveSessions = [
    {
        chargePointId: 'CP-001',
        maxHardwareKw: 50,
        currentSoc: 20,
        targetSoc: 80,
        departureTime: DateTime.now().plus({ hours: 1 }).toISO()
    },
    {
        chargePointId: 'CP-002',
        maxHardwareKw: 50,
        currentSoc: 70,
        targetSoc: 80,
        departureTime: DateTime.now().plus({ hours: 10 }).toISO()
    }
];

console.log('--- DLM ALLOCATION TEST ---');
console.log(`Site Limit: ${mockSiteLimitKw}kW`);
console.log(`Building Load: ${mockBuildingLoadKw}kW`);
console.log(`Available Headroom: ${mockSiteLimitKw * 0.95 - mockBuildingLoadKw}kW (with 5% safety buffer)`);

const allocations = calculateAllocations(mockSiteLimitKw, mockBuildingLoadKw, mockActiveSessions);

console.log('\nAllocations:');
allocations.forEach(a => {
    console.log(`- ${a.chargePointId}: ${a.allocatedKw}kW (${a.reason})`);
});

// Verify CP-001 gets more due to priority
const cp001 = allocations.find(a => a.chargePointId === 'CP-001');
const cp002 = allocations.find(a => a.chargePointId === 'CP-002');

if (cp001.allocatedKw > cp002.allocatedKw) {
    console.log('\n✅ Priority Logic Verified: High-priority vehicle received more power.');
} else {
    console.log('\n❌ Priority Logic Failed: High-priority vehicle did not receive more power.');
}

console.log('\n--- EMERGENCY SHED TEST ---');
const extremeBuildingLoad = 110;
const shedAllocations = calculateAllocations(mockSiteLimitKw, extremeBuildingLoad, mockActiveSessions);
console.log(`Building Load: ${extremeBuildingLoad}kW`);
shedAllocations.forEach(a => {
    console.log(`- ${a.chargePointId}: ${a.allocatedKw}kW (${a.reason})`);
});

if (shedAllocations.every(a => a.allocatedKw === 0)) {
    console.log('\n✅ Emergency Shed Verified: All loads dropped to 0 during building overload.');
} else {
    console.log('\n❌ Emergency Shed Failed.');
}

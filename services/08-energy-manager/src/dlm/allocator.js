const { DateTime } = require('luxon');

/**
 * Calculates the optimal power distribution for a fleet of active chargers.
 * @param {number} siteLimitKw - Maximum safe draw for the site's transformer
 * @param {number} buildingLoadKw - Current non-EV draw (e.g., the building itself)
 * @param {Array} activeSessions - List of active chargers and their constraints
 * @param {number} safetyBufferPercent - Percentage to hold back to prevent tripped breakers (e.g., 0.05 for 5%)
 * @returns {Array} - Array of new power limits to broadcast to L7
 */
function calculateAllocations(siteLimitKw, buildingLoadKw, activeSessions, safetyBufferPercent = 0.05) {
    // 1. Calculate Safe Headroom (The Fuse Rule)
    const safeLimitKw = siteLimitKw * (1 - safetyBufferPercent);
    const availableHeadroomKw = Math.max(0, safeLimitKw - buildingLoadKw);

    // Extreme Edge Case: The building itself is overloading the transformer. Shed all EV load immediately.
    if (availableHeadroomKw === 0) {
        return activeSessions.map(session => ({
            chargePointId: session.chargePointId,
            allocatedKw: 0.0,
            reason: 'EMERGENCY_SHED'
        }));
    }

    // 2. Update Priority Scores based on "Mobility First" formula
    // Priority Score = (Target SoC % - Current SoC %) / Hours to Departure
    const now = DateTime.now();
    const sessionsWithPriority = activeSessions.map(session => {
        let priority = 1.0;
        if (session.departureTime && session.targetSoc && session.currentSoc !== undefined) {
            const departure = DateTime.fromISO(session.departureTime);
            const hoursToDeparture = Math.max(0.1, departure.diff(now, 'hours').hours);
            const socDeficit = Math.max(0, session.targetSoc - session.currentSoc);
            priority = socDeficit / hoursToDeparture;
        }
        return { ...session, priorityScore: Math.max(0.1, priority) };
    });

    // 3. Initial Setup for Water-Filling Algorithm
    let remainingCapacityKw = availableHeadroomKw;
    let unresolvedSessions = [...sessionsWithPriority];
    const allocations = [];

    // 4. Iterative Distribution
    // We iterate because if a charger hits its physical maximum, its "leftover" power
    // must be redistributed to the other chargers that can still take more.
    while (unresolvedSessions.length > 0 && remainingCapacityKw > 0.1) {
        // Calculate the total priority weight of the remaining pool
        const totalPriority = unresolvedSessions.reduce((sum, s) => sum + s.priorityScore, 0);

        const nextIterationSessions = [];

        for (const session of unresolvedSessions) {
            // Proportional share based on priority score (e.g., VIP drivers get a larger slice)
            const theoreticalShare = remainingCapacityKw * (session.priorityScore / totalPriority);

            // The charger cannot accept more than its physical hardware limit
            const actualAllocation = Math.min(theoreticalShare, session.maxHardwareKw);

            if (actualAllocation === session.maxHardwareKw) {
                // This charger is maxed out. Lock its allocation and remove from future iterations.
                allocations.push({
                    chargePointId: session.chargePointId,
                    allocatedKw: Number(actualAllocation.toFixed(2)),
                    reason: 'MAX_HARDWARE_REACHED'
                });
                remainingCapacityKw -= actualAllocation;
            } else {
                // This charger can still take more power if others max out. Keep it in the pool.
                session.currentDraftAllocation = actualAllocation;
                nextIterationSessions.push(session);
            }
        }

        // If no chargers maxed out this round, we are perfectly balanced.
        if (nextIterationSessions.length === unresolvedSessions.length) {
            for (const session of nextIterationSessions) {
                allocations.push({
                    chargePointId: session.chargePointId,
                    allocatedKw: Number(session.currentDraftAllocation.toFixed(2)),
                    reason: 'PROPORTIONAL_SHARE'
                });
                remainingCapacityKw -= session.currentDraftAllocation;
            }
            break; // Exit the while loop
        }

        unresolvedSessions = nextIterationSessions;
    }

    // 5. Handle any remaining chargers if we ran out of capacity perfectly
    for (const session of unresolvedSessions) {
        if (!allocations.find(a => a.chargePointId === session.chargePointId)) {
             allocations.push({
                 chargePointId: session.chargePointId,
                 allocatedKw: Number((session.currentDraftAllocation || 0).toFixed(2)),
                 reason: 'CAPACITY_EXHAUSTED'
             });
        }
    }

    return allocations;
}

module.exports = { calculateAllocations };

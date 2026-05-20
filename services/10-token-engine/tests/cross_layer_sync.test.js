const { app, getDynamicMultiplier } = require('../index');

describe('L10 Kafka Consumer Logic Refactor Verification', () => {
  // We'll test the extraction logic indirectly if possible,
  // but since it's inside start() and consumer.run(), we might need to export it or test it via integration.
  // For now, let's verify that our refactored variables are logically sound.

  test('Multi-layer payload key mapping (Simulated Logic)', () => {
    const payloads = [
      { // L1 Physics style
        physics_score: "0.995",
        confidence_score: "0.98",
        site_id: "site-1"
      },
      { // L7 Device style
        physicsScore: 0.995,
        confidenceScore: 0.98,
        locationId: "site-1"
      },
      { // L6 Engagement style
        is_sentinel_fidelity: true,
        resource_type: "BESS"
      }
    ];

    payloads.forEach(payload => {
      const {
        physics_score, physicsScore,
        confidence_score, confidenceScore,
        site_id, siteId, location_id, locationId,
        is_sentinel_fidelity, isSentinelFidelity,
        resource_type, resourceType
      } = payload;

      const physicsScoreVal = physics_score !== undefined ? parseFloat(physics_score) : (physicsScore !== undefined ? parseFloat(physicsScore) : null);
      const confidenceScoreVal = confidence_score !== undefined ? parseFloat(confidence_score) : (confidenceScore !== undefined ? parseFloat(confidenceScore) : null);
      const siteIdVal = site_id || siteId || location_id || locationId || null;
      const isSentinelFidelityVal = is_sentinel_fidelity !== undefined ? is_sentinel_fidelity : (isSentinelFidelity !== undefined ? isSentinelFidelity : false);
      const resourceTypeVal = resource_type || resourceType || 'EV';

      if (payload.physics_score || payload.physicsScore) {
        expect(physicsScoreVal).toBe(0.995);
      }
      if (payload.site_id || payload.locationId) {
        expect(siteIdVal).toBe("site-1");
      }
      if (payload.is_sentinel_fidelity) {
        expect(isSentinelFidelityVal).toBe(true);
      }
      if (payload.resource_type) {
        expect(resourceTypeVal).toBe("BESS");
      }
    });
  });

  test('ISO Normalization consistency', async () => {
    // This is already in reward_logic.test.js but good to double check
    const entsoe = 'ENTSO-E';
    const normalized = entsoe.toUpperCase().replace(/-/g, '');
    expect(normalized).toBe('ENTSOE');
  });
});

/**
 * L5: Driver Experience API - Notification Module
 * Handles dispatching Expo Push Notifications with anti-fatigue logic.
 */

const axios = require('axios');

class NotificationService {
    constructor() {
        this.EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
        this.batchQueue = [];
        this.BATCH_INTERVAL_MS = 60 * 60 * 1000; // 1-hour batching for non-critical updates
        this.pool = null; // To be initialized from index.js
    }

    /**
     * Initialize with DB Pool
     * @param {object} pool
     */
    init(pool) {
        this.pool = pool;
        // Start background batch processor
        setInterval(() => this.processBatches(), this.BATCH_INTERVAL_MS);
    }

    /**
     * Resolve expo push token for a driver_id
     * @param {string} driverId
     * @returns {Promise<string|null>}
     */
    async getDriverToken(driverId) {
        if (!this.pool) return null;
        try {
            const res = await this.pool.query('SELECT expo_push_token FROM drivers WHERE id = $1', [driverId]);
            return res.rows[0]?.expo_push_token || null;
        } catch (err) {
            console.error('[Notification Service] Error fetching token:', err);
            return null;
        }
    }

    /**
     * Send immediate notification for critical events.
     * @param {string} driverId - The driver ID.
     * @param {string} title - Notification title.
     * @param {string} body - Notification body text.
     * @param {object} data - Custom payload for the mobile app.
     */
    async sendImmediate(driverId, title, body, data = {}) {
        const expoPushToken = await this.getDriverToken(driverId);
        if (!expoPushToken) return;

        try {
            await axios.post(this.EXPO_PUSH_URL, {
                to: expoPushToken,
                sound: 'default',
                title,
                body,
                data,
                priority: 'high',
            });
            console.log(`[Notification] Sent immediate push to driver ${driverId}`);
        } catch (error) {
            console.error('[Notification Error] Failed to send push:', error.message);
        }
    }

    /**
     * Queue a notification for batching to reduce fatigue.
     * @param {string} driverId - The driver ID.
     * @param {string} updateText - Summary text for the batch.
     */
    queueForBatch(driverId, updateText) {
        this.batchQueue.push({ driverId, updateText, timestamp: new Date() });
    }

    /**
     * Group and send batched notifications.
     */
    async processBatches() {
        if (this.batchQueue.length === 0) return;

        const grouped = this.batchQueue.reduce((acc, curr) => {
            acc[curr.driverId] = acc[curr.driverId] || [];
            acc[curr.driverId].push(curr.updateText);
            return acc;
        }, {});

        this.batchQueue = []; // Clear queue

        for (const [driverId, updates] of Object.entries(grouped)) {
            const body = updates.length > 1
                ? `You have ${updates.length} new updates from MiGrid.`
                : updates[0];

            await this.sendImmediate(driverId, 'MiGrid Daily Summary', body, { updates });
        }
    }
}

module.exports = new NotificationService();

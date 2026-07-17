import { getStore } from "@netlify/blobs";

// This function runs every 2 minutes on Netlify's servers (even when no one visits the site)
// It fetches the latest 10 messages from the API and merges them into persistent storage

const API_URL = "http://51.77.216.195/crapi/lamix/viewstats?token=aXZ0gVZXgoCAc2loX4iFSl9mVWB8hVdgdFVhW3SVZXM=";
const MAX_STORED = Number.MAX_SAFE_INTEGER;
const RESET_KEY = "reset-state";

function msgKey(item) {
    return `${item.dt}|${item.num}|${item.message}`;
}

function shouldReset(now = new Date()) {
    const resetHour = 5;
    const resetMinute = 30;
    const resetTime = new Date(now);
    resetTime.setHours(resetHour, resetMinute, 0, 0);

    if (now < resetTime) return false;
    return true;
}

function parseTimestamp(value) {
    if (!value) return null;
    const text = String(value).replace(" ", "T");
    const parsed = new Date(text.endsWith("Z") ? text : `${text}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function clearStoredMessages(store) {
    try {
        await store.delete("messages");
    } catch (err) {
        try {
            await store.setJSON("messages", []);
        } catch (fallbackErr) {
            console.warn("Could not clear messages blob during scheduled collection:", fallbackErr);
        }
    }

    await store.set(RESET_KEY, new Date().toISOString());
}

export default async (req, context) => {
    try {
        const store = getStore("lamix-messages");

        // 1. Fetch live data from API
        const res = await fetch(API_URL);
        if (!res.ok) {
            return new Response(`API returned ${res.status}`, { status: 502 });
        }

        const json = await res.json();
        if (json.status !== "success" || !json.data) {
            return new Response("API returned non-success", { status: 502 });
        }

        // 2. Load existing stored messages
        let existing = [];
        try {
            const raw = await store.get("messages", { type: "json" });
            if (Array.isArray(raw)) existing = raw;
        } catch (e) {
            // First run - no data yet
        }

        let resetState = "";
        try {
            resetState = await store.get(RESET_KEY, { type: "text" });
        } catch (e) {
            // No reset marker yet
        }

        const now = new Date();
        const resetWindow = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 30, 0, 0);
        const parsedResetState = resetState ? parseTimestamp(resetState) : null;
        const shouldClear = shouldReset(now) && (!parsedResetState || parsedResetState < resetWindow);

        if (shouldClear) {
            existing = [];
            await clearStoredMessages(store);
        }

        const minimumTimestamp = parsedResetState ? parsedResetState.getTime() : null;
        const freshItems = (json.data || []).filter(item => {
            const itemTime = parseTimestamp(item.dt)?.getTime();
            if (minimumTimestamp === null || itemTime === null) return true;
            return itemTime >= minimumTimestamp;
        });

        const freshExisting = existing.filter(item => {
            const itemTime = parseTimestamp(item.dt)?.getTime();
            if (minimumTimestamp === null || itemTime === null) return true;
            return itemTime >= minimumTimestamp;
        });

        // 3. Merge: deduplicate by key
        const map = new Map();
        freshExisting.forEach(item => map.set(msgKey(item), item));
        freshItems.forEach(item => map.set(msgKey(item), item));

        // 4. Sort newest first, keep all messages until the next reset window
        const merged = [...map.values()]
            .sort((a, b) => new Date(b.dt.replace(" ", "T") + "Z") - new Date(a.dt.replace(" ", "T") + "Z"));

        // 5. Save back to Netlify Blobs
        await store.setJSON("messages", merged);

        const msg = `Collected: ${freshItems.length} from API, ${freshExisting.length} existing → ${merged.length} total stored (${merged.length - freshExisting.length} new)`;
        console.log(msg);

        return new Response(msg, { status: 200 });

    } catch (err) {
        console.error("Collect error:", err);
        return new Response(`Error: ${err.message}`, { status: 500 });
    }
};

// Run every 2 minutes, 24/7
export const config = {
    schedule: "*/2 * * * *",
};

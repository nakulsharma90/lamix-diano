import { getStore } from "@netlify/blobs";

// This function runs every 2 minutes on Netlify's servers (even when no one visits the site)
// It fetches the latest 10 messages from the API and merges them into persistent storage

const API_URL = "http://51.77.216.195/crapi/lamix/viewstats?token=aXZ0gVZXgoCAc2loX4iFSl9mVWB8hVdgdFVhW3SVZXM=";
const MAX_STORED = 500;

function msgKey(item) {
    return `${item.dt}|${item.num}|${item.message}`;
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

        // 3. Merge: deduplicate by key
        const map = new Map();
        existing.forEach(item => map.set(msgKey(item), item));
        json.data.forEach(item => map.set(msgKey(item), item));

        // 4. Sort newest first, trim to MAX_STORED
        const merged = [...map.values()]
            .sort((a, b) => new Date(b.dt.replace(" ", "T") + "Z") - new Date(a.dt.replace(" ", "T") + "Z"))
            .slice(0, MAX_STORED);

        // 5. Save back to Netlify Blobs
        await store.setJSON("messages", merged);

        const msg = `Collected: ${json.data.length} from API, ${existing.length} existing → ${merged.length} total stored (${merged.length - existing.length} new)`;
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

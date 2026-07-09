import { getStore } from "@netlify/blobs";

// API endpoint that serves and clears stored messages for the frontend

function getResetKey() {
    return "reset-state";
}

function shouldReset(now = new Date()) {
    const resetHour = 5;
    const resetMinute = 30;
    const resetTime = new Date(now);
    resetTime.setHours(resetHour, resetMinute, 0, 0);

    if (now < resetTime) return false;

    return true;
}

export default async (req, context) => {
    try {
        const store = getStore("lamix-messages");

        if (req.method === "POST" || req.method === "DELETE") {
            await store.setJSON("messages", []);
            await store.set(getResetKey(), new Date().toISOString());
            return new Response(
                JSON.stringify({ status: "success", cleared: true, source: "stored" }),
                {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-cache",
                    },
                }
            );
        }

        let messages = [];
        try {
            const raw = await store.get("messages", { type: "json" });
            if (Array.isArray(raw)) messages = raw;
        } catch (e) {
            // No data stored yet
        }

        return new Response(
            JSON.stringify({
                status: "success",
                total: messages.length,
                source: "stored",
                data: messages,
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                },
            }
        );
    } catch (err) {
        console.error("Messages error:", err);
        return new Response(
            JSON.stringify({ status: "error", message: err.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
};

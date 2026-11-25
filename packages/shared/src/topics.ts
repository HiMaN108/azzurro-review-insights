// Operational topic taxonomy. Keyword rules are the transparent baseline classifier;
// an optional LLM pass can refine them. Keep terms lowercase; matched on word boundaries.
export const TOPIC_KEYS = [
  "CLEANLINESS", "CHECK_IN", "STAFF", "NOISE", "FACILITIES",
  "LOCATION", "ROOM_CONDITION", "VALUE", "COMFORT", "WIFI",
] as const;
export type TopicKey = (typeof TOPIC_KEYS)[number] | "OTHER";

export interface TopicDef {
  key: TopicKey;
  label: string;       // Shown in the dashboard
  description: string; // Tooltip for ops staff
  keywords: string[];
}

export const TOPICS: TopicDef[] = [
  { key: "CLEANLINESS", label: "Cleanliness", description: "Dirt, dust, stains, smells, pests, housekeeping",
    keywords: ["clean", "dirty", "dust", "dusty", "stain", "stained", "smell", "smelly", "smelt", "odour", "odor", "mould", "mold", "hair", "cockroach", "cockroaches", "bugs", "bed bugs", "filthy", "grime", "housekeeping", "spotless", "hygiene", "unhygienic"] },
  { key: "CHECK_IN", label: "Check-in & check-out", description: "Arrival, keys, codes, self check-in, reception hours",
    keywords: ["check in", "check-in", "checkin", "check out", "check-out", "checkout", "arrival", "arrived", "key", "keys", "key card", "code", "access", "self check", "lockbox", "late check", "early check", "reception closed", "instructions"] },
  { key: "STAFF", label: "Staff & service", description: "Reception, friendliness, helpfulness, responsiveness",
    keywords: ["staff", "reception", "receptionist", "manager", "friendly", "rude", "helpful", "unhelpful", "service", "host", "front desk", "polite", "welcoming", "customer service", "responsive"] },
  { key: "NOISE", label: "Noise", description: "Street, neighbours, thin walls, aircon or plumbing noise",
    keywords: ["noise", "noisy", "loud", "quiet", "thin walls", "traffic", "party", "music", "sleep", "slept", "earplugs", "soundproof"] },
  { key: "FACILITIES", label: "Facilities", description: "Kitchen, laundry, lift, parking, shared spaces",
    keywords: ["kitchen", "laundry", "lift", "elevator", "stairs", "parking", "facilities", "pool", "gym", "breakfast", "common area", "lounge", "luggage", "storage", "fridge", "microwave", "kettle"] },
  { key: "LOCATION", label: "Location", description: "Area, transport, proximity to attractions",
    keywords: ["location", "located", "close to", "walking distance", "station", "transport", "bus", "train", "area", "neighbourhood", "neighborhood", "central", "convenient", "stadium", "restaurants nearby"] },
  { key: "ROOM_CONDITION", label: "Room condition", description: "Maintenance, broken items, dated furniture, bathroom state",
    keywords: ["broken", "old", "dated", "tired", "worn", "renovation", "renovate", "renovated", "maintenance", "leak", "leaking", "shower", "bathroom", "toilet", "plumbing", "door", "window", "carpet", "paint", "furniture", "small room", "tiny", "cramped", "aircon", "air con", "air conditioning", "heating", "hot water"] },
  { key: "VALUE", label: "Value for money", description: "Price vs. quality, hidden fees, deposits",
    keywords: ["price", "value", "expensive", "overpriced", "cheap", "worth", "money", "cost", "fee", "fees", "charge", "charged", "deposit", "refund", "budget", "affordable"] },
  { key: "COMFORT", label: "Bed & comfort", description: "Bed, pillows, linen, temperature",
    keywords: ["bed", "beds", "mattress", "pillow", "pillows", "linen", "sheets", "towel", "towels", "comfortable", "uncomfortable", "comfy", "hot", "cold"] },
  { key: "WIFI", label: "Wi-Fi", description: "Internet availability and speed",
    keywords: ["wifi", "wi-fi", "internet", "connection"] },
];

// 1) Set your Apps Script Web App URL here after deploying apps_script_code.gs
const backendUrl = ""; // e.g., "https://script.google.com/macros/s/AKfycbyctl3nWmtmfz7Q296SSJpeVPKCEnO-Ya_JSxMXOnBngv2zfly2I9rQ0occK8HKF_c0/exec"

// 2) Portrait recognition config
// If you commit /portraits plus /portraits/manifest.json, the site will load them automatically.
// Otherwise, you can import a ZIP of portraits at runtime.
const portraitConfig = {
  hashSize: 16,          // aHash size (16 -> 256-bit)
  maxCompare: 5000,      // safety cap
  matchThreshold: 60     // max Hamming distance to accept a match (tune up/down)
};

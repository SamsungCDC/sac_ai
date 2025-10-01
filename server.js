import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const basic = Buffer.from("P2007615146:1qazXSW@#E").toString("base64");
  const r = await fetch("https://development-sec.it-cpi015-rt.cfapps.ap12.hana.ondemand.com/http/ai/test", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(req.body)
  });
  const data = await r.text();
  try { res.json(JSON.parse(data)); }
  catch { res.send(data); }
});

app.listen(8787, () => console.log("Proxy API running on 8787"));

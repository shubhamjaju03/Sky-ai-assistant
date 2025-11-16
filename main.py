from flask import Flask, request, jsonify, send_from_directory
from google import genai
import re

app = Flask(__name__, static_folder="static")

client = genai.Client(
    api_key="AIzaSyB-nPBcXfQJp3B5zcBymKg2LESH2K7RSnU"
)

conversation_mode = None


# ---------- CLEAN TEXT ----------
def clean(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"[#*_`~\[\]\(\){}>|-]", "", text)
    return text.strip()


@app.route("/")
def home():
    return send_from_directory(".", "index.html")


@app.route("/chat", methods=["POST"])
def chat():
    global conversation_mode

    data = request.get_json(force=True)
    user_msg = data.get("message", "").strip().lower()

    if not user_msg:
        return jsonify({"reply": "Please say something.", "follow_up": False})

    # --------------------------------------
    # UNIVERSAL FOLLOW-UP MODE
    # --------------------------------------
    if conversation_mode:
        mode = conversation_mode
        conversation_mode = None

        # WEATHER FOLLOW-UP
        if mode == "weather":
            try:
                r = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=f"""
Answer strictly in a very short line.
Format example:
Kolkata has sunny weather with 34 degree Celsius.

User city: {user_msg}
"""
                )
                reply = clean(r.text)
            except:
                reply = "I could not get the weather."

            return jsonify({"reply": reply, "follow_up": False})

        # OTHER FOLLOW-UPS
        try:
            r = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"Reply shortly. User follow-up: {user_msg}"
            )
            reply = clean(r.text)
        except:
            reply = "I could not process that."

        return jsonify({"reply": reply, "follow_up": False})

    # --------------------------------------
    # WEATHER REQUEST WITHOUT CITY
    # --------------------------------------
    if "weather" in user_msg and (" in " not in user_msg):
        conversation_mode = "weather"
        return jsonify({"reply": "Tell me the location.", "follow_up": True})

    # WEATHER REQUEST WITH CITY
    if "weather" in user_msg and " in " in user_msg:
        city = user_msg.split(" in ")[-1].strip()

        try:
            r = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"""
Give a very short weather reply for the city. 
Never add symbols or long sentences.
Always include temperature and condition.

Format:
Delhi has clear sky with 32 degree Celsius.

City: {city}
"""
            )
            reply = clean(r.text)
        except:
            reply = "I could not get the weather."

        return jsonify({"reply": reply, "follow_up": False})

    # --------------------------------------
    # CREATOR QUESTION
    # --------------------------------------
    if "who made you" in user_msg or "creator" in user_msg:
        return jsonify({"reply": "I was created by Shubham Jaju.", "follow_up": False})

    # --------------------------------------
    # SHORT OR LONG MODE DECISION
    # --------------------------------------
    long_required = any(k in user_msg for k in ["explain", "detailed", "long", "paragraph", "essay", "150"])

    # --------------------------------------
    # GENERATE NORMAL RESPONSE (FAST)
    # --------------------------------------
    try:
        r = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"""
Reply in short unless user asked for long explanation.
Do not use symbols or markdown.

User: {user_msg}
"""
        )
        reply = clean(r.text)
    except:
        reply = "I could not process that right now."

    # shorten if needed
    if not long_required and len(reply) > 140:
        reply = reply.split(".")[0] + "."

    return jsonify({"reply": reply, "follow_up": False})


if __name__ == "__main__":
    app.run(debug=True)

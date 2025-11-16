Here is the cleaned **README.md** without the preview section:

---

# **Shubham’s Voice Assistant (JARVIS-Style AI Assistant)**

A futuristic, browser-based voice assistant inspired by JARVIS.
Built using **HTML, CSS, JavaScript (Speech API)** and a **Flask + Gemini AI backend**.

This assistant can **listen**, **speak**, perform **smart commands**, open apps/websites, answer questions, and glow with animations — all inside your browser.

---

## 🚀 **Features**

### 🎙️ Voice Recognition

* Uses **Web Speech API**
* Hands-free interaction
* Auto-listens when required

### 💡 AI-Powered Brain

* Gemini Flash 2.5 model
* Gives short/long answers based on user’s request
* Study-related explanations (clean & simple)
* Weather handling with location follow-up
* No asterisks or symbols spoken

### 🔊 Speech Output

* Smooth speaking voice
* Talking glow while responding

### 🔵 Mic Button Effects

* Ripple waves when listening
* Pulse glow animation
* Centered circular design
* Positioned at Iron Man’s stomach area

### 🌐 Built-In Commands

| Command            | Action             |
| ------------------ | ------------------ |
| "Open Instagram"   | Opens Instagram    |
| "Open WhatsApp"    | Opens WhatsApp Web |
| "Open Discord"     | Opens Discord      |
| "Open YouTube"     | Opens YouTube      |
| "Open Twitter / X" | Opens X.com        |
| "Search for ___"   | Google search      |
| "Play ___"         | YouTube search     |

---

## 🌥️ Weather Query Logic

* If user says **“What’s the weather?”**
  → Assistant asks: **“Please tell me the location.”**
  → Auto-turns mic ON
* Weather reply format:
  **“Kolkata is sunny with 32 degree Celsius.”**

---

## 📁 Project Structure

```
project/
│── static/
│   ├── style.css
│   ├── mic.png
│   ├── initiating.gif
│   ├── live_wallpaper.gif
│── index.html
│── main.py
│── README.md
```

---

## ⚙️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/yourrepo.git
cd yourrepo
```

### 2. Install Python modules

```bash
pip install flask google-genai
```

### 3. Add your Gemini API key

In **main.py**:

```python
client = genai.Client(api_key="YOUR_API_KEY")
```

### 4. Start server

```bash
python main.py
```

### 5. Open in browser

```
http://localhost:5000
```

---

## 🧠 How It Works

### Frontend

* Speech recognition
* Speech synthesis
* UI animations (glow, ripples)

### Backend

* Flask routes
* Gemini AI processing
* Returns short and clean responses

---

## 🛠 Customize Commands

Add more commands inside **index.html**:

```js
if (text.includes("open facebook")) {
    speak("Opening Facebook");
    window.open("https://facebook.com", "_blank");
    return;
}
```

---

## 🔮 Future Enhancements

* Launch system apps (Python integration)
* Add memory storage
* Add UI widgets
* Dark/light themes

---

## 📝 License

MIT License — free to use and modify.

---
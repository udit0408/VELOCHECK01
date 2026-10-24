# VELOCHECK — ESP32-to-phone tyre monitor

## Laptop-free operation (recommended)

The ESP32 is the local backend. It creates a Wi-Fi network and stores the most recent 40 readings in its own memory. The installed Android app calls the ESP32 directly; no computer, Internet connection, cloud service, or Python server is involved.

1. In Arduino IDE, install **ArduinoJson 6** from Library Manager.
2. Open `esp32/velocheck_esp32.ino`, change `AP_PASSWORD`, and replace the three `read...` functions with your sensor code.
3. Flash it to the ESP32.
4. Join your phone to Wi-Fi network `VELOCHECK-ESP32` (the default password is in the sketch).
5. In the app, open **Settings**, enter `http://192.168.4.1`, and save.
6. Open the Bike page. Gauges update every 2 seconds. Tap any gauge or donut-chart slice to see previous record, measuring time, average of up to 20 records, and the next transparent trend prediction.

The supplied sketch is configured for a two-wheel bike (`front`, `rear`). For a car, change `sampleSensors()` to add `front_left`, `front_right`, `rear_left`, and `rear_right`; the app already supports those wheel names.

## Build the Android app

```powershell
npm run sync
cd android
.\gradlew assembleDebug
```

The APK is created under `android/app/build/outputs/apk/debug/`. The Android project allows local `http://192.168.4.1` traffic so it can communicate with the ESP32.

## Optional FastAPI backend

`main.py` remains available for desktop/LAN development, durable SQLite history, or receiving readings from a separate ESP32 client:

```powershell
py -m pip install -r requirements.txt
py -m uvicorn main:app --host 0.0.0.0 --port 8000
```

With the Settings endpoint blank, the PWA uses the same-host FastAPI API. It includes `POST /api/readings`, latest/history APIs, and the `/api/readings/analytics` endpoint used by the clickable chart details.

## Reading shape

```json
{"device_id":"VELOCHECK-ESP32-001","vehicle_type":"bike","wheel":"front","pressure_kpa":220,"temperature_c":31,"tread_depth_mm":4.6}
```

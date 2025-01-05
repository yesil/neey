# Chat PWA

A simple Progressive Web App that implements a chat interface. The app works offline and can be installed on supported devices.

## Features

- Modern chat interface
- Works offline
- Installable as a PWA
- Message persistence using localStorage
- Responsive design

## Setup

1. Clone this repository
2. Serve the files using a static web server. For example:
   - Using Python: `python -m http.server 8000`
   - Using Node.js: `npx serve`
3. Open your browser and navigate to the local server (e.g., `http://localhost:8000`)

## PWA Installation

1. Open the website in a supported browser (Chrome, Edge, etc.)
2. You should see an install prompt in the address bar
3. Click "Install" to add the app to your device

## Development

The app consists of the following files:
- `index.html`: Main HTML structure
- `styles.css`: Styling and layout
- `app.js`: Chat functionality
- `sw.js`: Service Worker for offline functionality
- `manifest.json`: PWA configuration
- `icons/`: App icons

## Note

For the PWA to work properly, you need to serve it over HTTPS in production. Local development over HTTP is fine. 
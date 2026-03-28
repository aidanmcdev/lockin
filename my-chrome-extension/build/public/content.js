import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const existing = document.getElementById("my-extension-popup");

if (!existing) {
  const container = document.createElement("div");
  container.id = "my-extension-popup";

  Object.assign(container.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    width: "300px",
    height: "400px",
    zIndex: "2147483647",
    background: "white",
    border: "1px solid #ccc",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    borderRadius: "8px",
    padding: "15px",
    overflow: "auto",
    fontFamily: "Arial, sans-serif",
  });

  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}

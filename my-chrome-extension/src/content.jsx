import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const existing = document.getElementById("my-extension-popup");

if (!existing) {
  const container = document.createElement("div");
  container.id = "my-extension-popup";

  Object.assign(container.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    zIndex: "2147483647",
  });

  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}

import { useState } from "react";
import { Card, CardContent, CardHeader } from "./components/ui/card";

export default function App() {
  const [visible, setVisible] = useState(true);

  if (!visible) {
    document.getElementById("my-extension-popup")?.remove();
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <h3 style={{ marginTop: 0 }}>Extension Popup Pablo Rogers</h3>
      </CardHeader>
      <CardContent>
        <p>This popup is automatically injected into the page DOM.</p>
        <button onClick={() => setVisible(false)} style={{ marginTop: "10px" }}>
          Close
        </button>
      </CardContent>
    </Card>
  );
}

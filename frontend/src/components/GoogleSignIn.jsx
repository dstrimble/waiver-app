import { useEffect, useRef } from "react";

// Google Identity Services: renders the "Sign in with Google" button and hands
// back a signed ID token. There is no redirect - the backend verifies the token.
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let scriptPromise = null;

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("Could not load Google sign-in. Check your connection and refresh."));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export default function GoogleSignIn({ clientId, onCredential, onError }) {
  const buttonRef = useRef(null);
  // The button is initialised once; route callbacks through refs so it always
  // calls the latest handlers.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => handlers.current.onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
        });
      })
      .catch((err) => {
        if (!cancelled) handlers.current.onError?.(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={buttonRef} className="google-signin" />;
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import "./supabase-config.js";

window.supabase = { createClient };

async function start() {
  try {
    await import("./shared.js");
    const isOwnerPage = document.body.dataset.appPage === "owner";
    await window.Goodhands.initialize(isOwnerPage);
    await import(isOwnerPage ? "./owner.js" : "./app.js");
  } catch (error) {
    console.error("Could not start the Goodhands app.", error);
    const message = document.createElement("section");
    message.className = "startup-error";
    message.setAttribute("role", "alert");
    message.textContent = `The online booking app could not start: ${error.message}`;
    document.body.prepend(message);
  }
}

start();

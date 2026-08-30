self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // ignore malformed payloads
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/elevique-logo.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((all) => {
      const existing = all.find((c) => "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow("/validator/send");
    })
  );
});

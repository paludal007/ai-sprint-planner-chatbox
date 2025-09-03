document.addEventListener("DOMContentLoaded", () => {
  const uploadForm = document.getElementById("uploadForm");
  const fileInput = document.getElementById("fileInput");
  const clearBtn = document.getElementById("clearBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const tableWrap = document.getElementById("tableWrap");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatWindow = document.getElementById("chatWindow");

  let lastCsv = null;

  const loader = document.getElementById("loader");

  function showLoader() { loader.classList.remove("d-none"); }
  function hideLoader() { loader.classList.add("d-none"); }

  // ===============================
  // Upload CSV
  // ===============================
  if (uploadForm) {
    uploadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!fileInput.files.length) {
        alert("Please choose a CSV file.");
        return;
      }

      const formData = new FormData();
      formData.append("file", fileInput.files[0]);

      try {
        showLoader();
        const resp = await fetch("/api/predict", { method: "POST", body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Upload failed");

        lastCsv = data.csv;
        lastDataset = data.results || []; // store dataset
        renderTable(data.data);
        downloadBtn.disabled = false;
        hideLoader();
      } catch (err) {
        console.error(err);
        tableWrap.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        downloadBtn.disabled = true;
        hideLoader();
      }
    });
  }

  // ===============================
  // Clear data
  // ===============================
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      fileInput.value = "";
      lastCsv = null;
      downloadBtn.disabled = true;
      tableWrap.classList.add("text-muted", "fst-italic");
      tableWrap.textContent = "No data yet. Upload a CSV to see predictions.";

        try {
            await fetch("/api/clear", { method: "POST" }); // tell backend to reset
            console.log("Backend dataset cleared.");
        } catch (err) {
            console.error("Failed to clear dataset on backend:", err);
        }

    });
  }

  // ===============================
  // Download results
  // ===============================
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      if (!lastCsv) return;
      const blob = new Blob([lastCsv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "predictions.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  // ===============================
  // Chat assistant
  // ===============================
  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = chatInput.value.trim();
      if (!msg) return;

      pushMsg("user", msg);
      chatInput.value = "";

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg, dataset: lastDataset }), // include dataset
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Chat failed");

        pushMsg("bot", data.reply || "");
      } catch (err) {
        pushMsg("bot", err.message || "Chat error");
      }
    });
  }

  // ===============================
  // Helpers
  // ===============================
  function pushMsg(role, text) {
    const div = document.createElement("div");
    div.className = role === "user" ? "user-msg" : "bot-msg";
    div.textContent = text;
    const wrapper = document.createElement("div");
    wrapper.appendChild(div);
    chatWindow.appendChild(wrapper);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function renderTable(data) {
  if (!data || !data.length) {
    tableWrap.innerHTML = `<p class="text-muted fst-italic">No data available.</p>`;
    return;
  }

  let html = `
    <table class="table table-hover align-middle">
      <thead>
        <tr>
          <th>#</th>
          <th>Summary</th>
          <th>Description</th>
          <th>Priority</th>
          <th>Story Points</th>
          <th>Estimate Hours</th>
        </tr>
      </thead>
      <tbody>
  `;

  data.forEach((row, i) => {
    const priorityClass = row.Priority
      ? `priority-${row.Priority.toLowerCase()}`
      : "";

    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${row.Summary || ""}</td>
        <td>${row.Description || ""}</td>
        <td class="${priorityClass}">${row.Priority}</td>
        <td>${row.StoryPoints}</td>
        <td>${row.EstimateHours}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  tableWrap.innerHTML = html;
}

});

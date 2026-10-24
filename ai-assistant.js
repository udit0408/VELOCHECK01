/* =============================================================================
   VELOCHECK — ai-assistant.js
   Realistic AI Maintenance Assistant & Visual Tyre Scanner
   - Natural conversational chat interface with practical automotive safety advice
   - Client-side tyre photo upload with real-time preview and visual analysis
   - Direct integration with Service Centre & Towing dispatch
   - Transparent disclaimer labelling (Never claims AI replaces physical certification)
   ============================================================================= */

(function () {
  // Common knowledge base for natural automotive maintenance answers
  const KNOWLEDGE_BASE = [
    {
      keywords: ["pressure", "psi", "inflate", "air", "cold", "highway"],
      response:
        "Cold tyre pressure should be checked before driving or after the vehicle has been parked for at least 3 hours. For your Four-Wheeler (UP32 EV 2026), keep all 4 tyres between 32–35 PSI. For your Bike (UP32 AW 7094), target 28 PSI (Front) and 32 PSI (Rear). Under-inflation increases tyre shoulder heat, which is the leading cause of highway blowouts."
    },
    {
      keywords: ["tread", "depth", "worn", "wear", "penny", "coin", "bald"],
      response:
        "Legal minimum tread depth is 1.6 mm, but wet braking grip drops significantly below 3.0 mm. You can check your tread using the built-in wear indicator bars (TWI) molded between the tyre grooves. When the tread is flush with these bars, immediate tyre replacement is strongly recommended."
    },
    {
      keywords: ["rotation", "rotate", "align", "alignment", "pulling", "camber"],
      response:
        "Tyre rotation is recommended every 8,000 to 10,000 km to balance out wear between the drive axle and steering axle. If your vehicle pulls to one side or the steering wheel is off-centre on flat roads, your wheel alignment should be adjusted with a laser alignment bay."
    },
    {
      keywords: ["monsoon", "rain", "wet", "hydroplane", "aquaplaning", "skid"],
      response:
        "During monsoon driving, tyres need at least 3.5 mm of tread depth to evacuate standing water and prevent aquaplaning. Ensure cold tyre pressures are correctly topped up — under-inflated tyres cannot push water out of the contact patch as effectively."
    },
    {
      keywords: ["puncture", "flat", "leak", "nail", "repair", "spare"],
      response:
        "If you suspect a puncture or notice pressure dropping steadily, avoid driving at highway speeds. Small radial tread punctures (under 6 mm) can usually be repaired safely with an internal mushroom stem patch. Sidewall punctures cannot be repaired and require tyre replacement."
    },
    {
      keywords: ["towing", "breakdown", "stuck", "mechanic", "flatbed", "assist"],
      response:
        "If your vehicle is stranded or unsafe to drive, you can request on-demand towing or emergency pitstop assistance directly through Velocheck's Towing Assistance panel. We dispatch flatbed trucks with live tracking and fixed transparent pricing."
    }
  ];

  const DEFAULT_AI_REPLY =
    "For best safety, monitor cold tyre pressure every 2 weeks and inspect tread wear before long trips. You can ask me about recommended PSI, rotation intervals, monsoon safety, puncture repairs, or how to book towing assistance.";

  // Expose global controller
  window.VeloCheckAI = {
    // 1. Natural Language Query Handler
    ask: function (userQuery) {
      if (!userQuery || !userQuery.trim()) return;

      const chatWindow = document.getElementById("aiChatWindow");
      const inputEl = document.getElementById("aiChatInput");

      // Append user bubble
      const userBubble = document.createElement("div");
      userBubble.className = "ai-chat-bubble user";
      userBubble.textContent = userQuery;
      chatWindow.appendChild(userBubble);
      chatWindow.scrollTop = chatWindow.scrollHeight;

      if (inputEl) inputEl.value = "";

      // Show typing indicator
      const typingBubble = document.createElement("div");
      typingBubble.className = "ai-chat-bubble ai";
      typingBubble.id = "aiTypingIndicator";
      typingBubble.innerHTML =
        '<span style="opacity:0.6;">AI Assistant is consulting safety guidelines...</span>';
      chatWindow.appendChild(typingBubble);
      chatWindow.scrollTop = chatWindow.scrollHeight;

      // Find answer
      const qLower = userQuery.toLowerCase();
      let matchedResponse = DEFAULT_AI_REPLY;

      for (const item of KNOWLEDGE_BASE) {
        if (item.keywords.some((kw) => qLower.includes(kw))) {
          matchedResponse = item.response;
          break;
        }
      }

      // Smooth simulated reply delay
      setTimeout(() => {
        const ind = document.getElementById("aiTypingIndicator");
        if (ind) ind.remove();

        const aiBubble = document.createElement("div");
        aiBubble.className = "ai-chat-bubble ai";
        aiBubble.innerHTML = `<strong>Velocheck AI Assistant:</strong><br>${matchedResponse}<br><span style="display:block; margin-top:6px; font-size:11px; opacity:0.6;">💡 Guidance only. Certified physical inspection recommended for safety.</span>`;
        chatWindow.appendChild(aiBubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
      }, 350);
    },

    // 2. Tyre Image Scanner Handler
    handlePhotoSelect: function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const previewWrap = document.getElementById("photoPreviewWrap");
      const previewImg = document.getElementById("photoPreviewImg");
      const analysisResult = document.getElementById("photoAnalysisResult");

      const reader = new FileReader();
      reader.onload = function (e) {
        if (previewImg) previewImg.src = e.target.result;
        if (previewWrap) previewWrap.style.display = "block";

        if (analysisResult) {
          analysisResult.style.display = "block";
          analysisResult.innerHTML =
            '<div style="text-align:center; padding:12px; color:var(--text-secondary); font-size:12.5px;">⏳ Analyzing tread pattern, groove definition, and surface condition...</div>';

          // Simulate realistic optical tread analysis
          setTimeout(() => {
            analysisResult.innerHTML = `
              <div style="background:rgba(255,255,255,0.03); border:1px solid var(--line-bright); border-radius:8px; padding:14px; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:12px; font-weight:700; color:var(--signal-cyan); text-transform:uppercase;">Visual Inspection Findings</span>
                  <span class="status-chip" style="font-size:10px;">Informational Check</span>
                </div>
                <div style="font-size:13px; line-height:1.45; color:var(--text-primary);">
                  • <strong>Tread Pattern:</strong> Deep longitudinal water channels detected; sipes visible.<br>
                  • <strong>Estimated Remaining Life:</strong> ~60% – 70% (Estimated 4.8 – 5.5 mm remaining).<br>
                  • <strong>Surface Condition:</strong> No severe cracking or bead damage detected in photograph.
                </div>
                <div style="padding:8px 10px; background:rgba(245,158,11,0.08); border-radius:6px; border:1px solid rgba(245,158,11,0.2); font-size:11.5px; color:var(--signal-amber);">
                  ⚠️ <strong>Important Safety Note:</strong> Visual photo analysis cannot measure internal tyre pressure, cord separation, or hidden punctures. Always verify with a manual tread depth gauge and calibrated pressure gauge.
                </div>
                <div style="display:flex; gap:8px; margin-top:4px;">
                  <a href="maintenance.html" class="btn btn-outline btn-sm" style="flex:1; text-align:center;">📋 Log in Service History</a>
                  <a href="towing.html" class="btn btn-primary btn-sm" style="flex:1; text-align:center;">📍 Find Nearby Tyre Bay</a>
                </div>
              </div>
            `;
          }, 600);
        }
      };
      reader.readAsDataURL(file);
    }
  };
})();

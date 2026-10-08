"use strict";
(() => {
  function create(canvas, message) {
    const ctx = canvas.getContext('2d');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
    let frame = null;
    let burstTimer = null;
    let lastAt = null;
    let particles = [];
    let active = false;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    const colors = ['#ffdf70', '#ff6b81', '#65e6ff', '#b994ff', '#72f59a', '#ffffff'];

    function resize() {
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function burst() {
      if (width !== window.innerWidth || height !== window.innerHeight) resize();
      particles = [];
      const originX = width * (0.34 + Math.random() * 0.32);
      const originY = height * (0.3 + Math.random() * 0.4);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const count = 30;
      for (let i = 0; i < count; i++) {
        const angle = Math.PI * 2 * i / count + (Math.random() - 0.5) * 0.08;
        const speed = 1.5 + Math.random() * 4;
        particles.push({
          x: originX, y: originY,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          age: 0, life: 650 + Math.random() * 450,
          radius: 2 + Math.random() * 3, color,
        });
      }
    }

    function draw(timestamp) {
      frame = null;
      if (!active) return;
      const delta = lastAt === null ? 16 : Math.min(timestamp - lastAt, 32);
      lastAt = timestamp;
      if (width !== window.innerWidth || height !== window.innerHeight) resize();

      ctx.clearRect(0, 0, width, height);
      particles = particles.filter(particle => {
        particle.age += delta;
        particle.x += particle.vx * delta / 16;
        particle.y += particle.vy * delta / 16;
        particle.vy += 0.055 * delta / 16;
        if (particle.age >= particle.life) return false;
        ctx.globalAlpha = Math.max(0, 1 - particle.age / particle.life);
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;
      if (particles.length) frame = requestAnimationFrame(draw);
    }

    function stop() {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      if (burstTimer !== null) clearInterval(burstTimer);
      frame = null;
      burstTimer = null;
      particles = [];
      canvas.classList.remove('show');
      message.classList.remove('show');
      ctx.clearRect(0, 0, width, height);
    }

    function start(winnerText) {
      stop();
      message.textContent = winnerText;
      message.classList.add('show');
      lastAt = null;
      if (reducedMotion) return;
      resize();
      canvas.classList.add('show');
      active = true;
      burst();
      frame = requestAnimationFrame(draw);
      burstTimer = setInterval(() => {
        if (!active) return;
        burst();
        if (frame === null) frame = requestAnimationFrame(draw);
      }, 1400);
    }

    return { start, stop };
  }

  window.MineVictoryCelebration = { create };
})();

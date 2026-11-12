// Tema guardado (src/utilidades/tema.ts) aplicado antes de pintar: evita un destello claro en modo oscuro.
      try {
        var t = localStorage.getItem('agc-tema')
        if (t === 'claro' || t === 'oscuro') document.documentElement.setAttribute('data-theme', t === 'oscuro' ? 'dark' : 'light')
      } catch (e) {}

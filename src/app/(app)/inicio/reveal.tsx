"use client";

import { useEffect, useRef, useState } from "react";

// Anima a entrada do conteúdo com um fade-in + leve deslize para cima.
// Sem dependências externas: usa IntersectionObserver para disparar quando
// a secção entra no ecrã (scroll) — e, para conteúdo já visível ao abrir a
// página (ex.: o hero), o observer dispara de imediato porque o elemento já
// está na viewport, dando o mesmo efeito de entrada ao carregar.
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

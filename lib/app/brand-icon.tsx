import { ImageResponse } from "next/og";

/** Ícono de la app: una camiseta con la flecha de "entra", en la paleta Fantasy. */
export function brandIcon(size: number, maskable = false) {
  const pad = maskable ? size * 0.12 : 0;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f0a26",
          borderRadius: maskable ? 0 : size * 0.22,
          padding: pad,
        }}
      >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
          <path
            d="M8 3 4 5.5 2.5 10l3 1.2V21h13v-9.8l3-1.2L20 5.5 16 3c-.6 1.7-2.2 2.8-4 2.8S8.6 4.7 8 3Z"
            fill="#00e0c6"
          />
          <path d="M12 17.5V10m0 0-3 3m3-3 3 3" stroke="#0f0a26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}

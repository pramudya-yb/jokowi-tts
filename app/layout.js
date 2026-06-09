import "./globals.css";

export const metadata = {
  title: "Jokowi Voice Generator - Text to Speech Indonesia",
  description:
    "Generator suara Jokowi gratis. Ubah teks menjadi suara dengan gaya bicara khas Presiden Jokowi menggunakan teknologi Text-to-Speech.",
  keywords: "jokowi, text to speech, tts, indonesia, voice generator, suara jokowi",
  icons: {
    icon: '/jokowi-avatar.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

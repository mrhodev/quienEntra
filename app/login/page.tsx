import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar · quienEntra" };

export default function LoginPage() {
  return <LoginForm />;
}

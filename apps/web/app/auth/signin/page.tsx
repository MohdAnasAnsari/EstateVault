import { AuthForm } from '@/components/auth-form';

export default function SignInPage() {
  return (
    <main className="page-wrap flex min-h-[calc(100vh-96px)] items-center justify-center py-16">
      <AuthForm mode="signin" />
    </main>
  );
}

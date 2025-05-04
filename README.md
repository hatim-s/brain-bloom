# 🚀 Next.js + shadcn/ui + Supabase Starter Kit

Welcome to your shiny new full-stack web application starter! This repo contains everything you need to build awesome web apps without the boring setup work. Let's get you from zero to hero in no time.

## ✨ What's in the Box?

This starter kit comes packed with goodness:

- **[Next.js](https://nextjs.org/)** - React framework with server-side rendering, routing, and more
- **[shadcn/ui](https://ui.shadcn.com/)** - Beautiful, accessible UI components that you can copy and paste
- **[Supabase](https://supabase.com/)** - Open source Firebase alternative with:
  - Authentication (email, social logins, etc.)
  - PostgreSQL database
  - Storage
  - Realtime subscriptions
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **Custom scrollbar styles** - Because default scrollbars are _so_ 2010
- **TypeScript** - For catching bugs before they catch you

## 🚦 Getting Started

### Prerequisites

- Node.js 18+ (20+ recommended)
- npm or pnpm or yarn (we use pnpm in examples)
- A Supabase account (free tier works great!)

### First-Time Setup

1. **Clone this repo and install dependencies**

```bash
# Clone it
git clone https://github.com/hatim-s/nextjs-shadcn-supabase-bootstrap.git my-awesome-app

# Enter the directory
cd my-awesome-app

# Install dependencies
pnpm install
```

2. **Set up your environment variables**

Copy the example environment file:

```bash
cp .env.example .env.local
```

3. **Set up Supabase**

This is where the magic happens! You need to:

- Create a new Supabase project at [supabase.com](https://supabase.com)
- Get your project URL and anon key from the Supabase dashboard
- Update your `.env.local` file with these values:

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

4. **Run the development server**

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000) to see your app in action! 🎉

## 🔧 Configuring Supabase

The boilerplate includes basic Supabase auth setup, but you'll want to configure it for your specific needs:

### Authentication Setup

1. Go to your Supabase project dashboard → Authentication → Providers
2. Configure the providers you want to use (Email, Google, GitHub, etc.)
3. Update the site URL and redirect URLs in Auth settings:
   - Site URL: `http://localhost:3000` (dev) or your production URL
   - Redirect URLs: Add `http://localhost:3000/auth/callback` (and your production equivalent)

### Database Schema

The starter comes with basic tables, but you'll want to set up your own:

1. Go to Supabase dashboard → SQL Editor
2. You can create tables using the web interface or run SQL scripts
3. Example table for a todo app:

```sql
-- Create a table for todos
CREATE TABLE todos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create a policy to restrict access
CREATE POLICY "Users can only see their own todos"
  ON todos FOR SELECT
  USING (auth.uid() = user_id);

-- Create policies for insert/update/delete
CREATE POLICY "Users can insert their own todos"
  ON todos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own todos"
  ON todos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own todos"
  ON todos FOR DELETE
  USING (auth.uid() = user_id);
```

## 🛠 Development Workflow

Here's how to make the most of this starter kit:

### Adding shadcn/ui Components

```bash
# Add a new component
pnpm dlx shadcn-ui@latest add button

# Add multiple components
pnpm dlx shadcn-ui@latest add card form input
```

### Working with Supabase

The starter includes helper functions in `lib/supabase.ts` for:
- Server-side Supabase access
- Client-side Supabase access
- Auth helpers

Example of fetching data from Supabase:

```tsx
// In a Server Component
import { createServerClient } from '@/lib/supabase/server';

export default async function Page() {
  const supabase = createServerClient();
  const { data: todos } = await supabase.from('todos').select('*');

  return (
    <div>
      {todos?.map(todo => (
        <div key={todo.id}>{todo.title}</div>
      ))}
    </div>
  );
}
```

### Custom Scrollbar Styles

We've included some fancy scrollbar styles! Use them like:

```jsx
<div className="scrollbar-thin scrollbar-blue scrollbar-hover-group">
  <div className="overflow-y-auto h-64">
    {/* Lots of content with a cool scrollbar */}
  </div>
</div>
```

Available classes:
- Sizes: `scrollbar-thin`, `scrollbar-auto`, `scrollbar-none`
- Colors: `scrollbar-gray`, `scrollbar-blue`, `scrollbar-green`, `scrollbar-red`
- Hover effect: Add `scrollbar-hover-group` to the parent element

## 📱 Production Deployment

Ready to launch? Let's do it!

1. Build your application:

```bash
pnpm build
```

2. Deploy to your platform of choice:
   - [Vercel](https://vercel.com) (recommended for Next.js apps)
   - [Netlify](https://netlify.com)
   - [Railway](https://railway.app)

For Vercel, you can connect your GitHub repo and it will automatically deploy when you push changes.

Don't forget to add your environment variables to your hosting platform!

## 📚 Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com)
- [Supabase Documentation](https://supabase.com/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## 🤔 Troubleshooting

**"I'm getting auth errors"**
- Double check your environment variables
- Make sure your Supabase project has the correct redirect URLs
- Check browser console for specific error messages

**"My database queries aren't working"**
- Check your Row Level Security (RLS) policies in Supabase
- Make sure you're signed in if querying protected data

## 🎨 Customization

This starter is meant to be a starting point. Feel free to:

- Change the color scheme (edit `tailwind.config.js`)
- Add/remove shadcn/ui components as needed
- Modify the database schema for your specific app
- Add more authentication providers
- Change the UI layout in `app/layout.tsx`
- Set up custom middleware for additional functionality

## 🙋‍♀️ Contributing

Found a bug or want to contribute? PRs are welcome! Please:

1. Fork the repo
2. Create a branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

Happy coding! 🎭✨ Remember: with great code comes great responsibility... to build awesome stuff!

*PS: If this starter helped you build something cool, give it a star and tell your friends!*

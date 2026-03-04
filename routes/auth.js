
import express from  'express';
import {supabaseAnon,supabaseAdmin, getAuthenticatedSupabaseClient} from  '../supabase.js';
import { authMiddleware } from '../middleware/auth.js';

import jwt from  'jsonwebtoken';


// const port = "http://localhost:3000";


const port = "https://www.3dpstl.com"

const router = express.Router();


router.put("/", authMiddleware, async (req, res) => {
  const userId = req.id;
  const { full_name, phone, avatar } = req.body;

  const { data, error } = await supabaseAnon
    .from("profiles")
    .update({ full_name, phone, avatar, updated_at: new Date() })
    .eq("id", userId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
});

router.put("/password", authMiddleware, async (req, res) => {
  const { currentEmail, newPassword } = req.body;

  if (currentEmail !== req.email) {
    return res.status(400).json({ error: "Not matched email!" });
  }


  // Update password
  const { error } = await supabaseAdmin.auth.admin.updateUserById(
    req.id,
    { password: newPassword }
  );

  if (error) return res.status(400).json({ error: error.message });

  const token = jwt.sign(
    {
      id: userId,
      email: data.user.email,
      isAdmin: profile.is_admin
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  await supabaseAdmin
    .from('profiles')
    .update({
      current_token: token,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);


  res.json({ success: true });
});

router.get("/", authMiddleware, async (req, res) => {
  const userId = req.id;

  const { data, error } = await supabaseAnon
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
});

router.post('/confirm-login', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    // Validate Supabase session
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = data.user.id;
    const email = data.user.email;

    // Fetch profile / role
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();

    const isAdmin = !!profile?.is_admin;

    // Issue YOUR JWT
    const appToken = jwt.sign(
      { userId, email, isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token: appToken,
      email,
      isAdmin,
    });

  } catch (err) {
    res.status(500).json({ error: 'Confirmation failed' });
  }
});


router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  try {
      const full_name = email.split('@')[0];
      
      // 2. Create user in Auth
      const { data: authUser, error: authError } = await supabaseAnon.auth.signUp({
          email,
          password,
            options: 
            {
              emailRedirectTo: 'https://www.3dpstl.com/auth/callback'
            }
      });
      
      // Check for error first. If error exists, it's not null.
      if (authError) {
          // logger.error(authError.message)
          return res.status(400).json({ error: authError.message });
      }

      const avatar = "";
      const createdAt = new Date().toISOString();
      
      // At this point, authUser.user is guaranteed to exist.
      const { error: insertError } = await supabaseAnon
      .from('profiles')
      .insert([{ id: authUser.user.id, full_name, email, avatar, created_at: createdAt, updated_at: createdAt }]);
      
      if (insertError) {
        // logger.error(authError.message)
        return res.status(400).json({ error: insertError.message });
    }
    
      // logger.info('User registered successfully');
      res.json({ message: 'User registered successfully', user: authUser.user });
  } catch (err) {
      // logger.error(err.message)
      res.status(500).json({ error: err.message });
  }
});

router.post('/updatePwd', authMiddleware, async (req, res) => {
  const { newPassword } = req.body;
  const userId = req.id; // from verified JWT

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    // Update password securely
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Get profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();

    if (profileError) {
      return res.status(400).json({ error: profileError.message });
    }

    const token = jwt.sign(
      {
        id: userId,
        email: data.user.email,
        isAdmin: profile.is_admin
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    await supabaseAdmin
      .from('profiles')
      .update({
        current_token: token,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    res.json({ message: "Password updated successfully", token });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  // forgot Pwd
  router.post('/ForgotPwd',  async (req, res) => {
  const { email } = req.body;
  
  try {
    // 1️⃣ Check if the email exists in profiles table
    const { data: profileData, error: profileError } = await supabaseAnon
      .from('profiles')
      .select('id') // just select minimal data
      .eq('email', email.trim())
      .single(); // we expect one row
      
      
      if (profileError) {
        // logger.error('ForgotPwd: Email Not Exist!')
        return res.status(400).json({ error: 'Email Not Exist!' });
      }
      
      if (profileData === '') {
        // logger.error('ForgotPwd: No user found with this email')
        return res.status(404).json({ error: 'No user found with this email' });
      }
      
    //   logger.info('ForgotPwd: Matched email');
      
      // 2️⃣ Email exists -> proceed with reset
      const { data: updateData, error: updateError } = await supabaseAnon.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: 'https://www.3dpstl.com/update-password' }
    );

    if (updateError) {
    //   logger.error(updateError.message);

      return res.status(400).json({ error: updateError.message });
    }

    // logger.info('Reset email sent successfully');
    res.json({ message: 'Reset email sent', user: updateData });
  } catch (err) {
    // logger.error(err.message);
    res.status(500).json({ error: err.message });
  }
  });

  router.post('/logoutAlldevices', async (req, res) => {
    const { email, recaptchaToken } = req.body;
    try {
      // Try signing in to verify credentials
    const response = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`,
      { method: "POST" }
    );
    const data = await response.json();

    if (!data.success) {
      return res.status(400).json({ error: "فشل التحقق من reCAPTCHA" });
    }
      
      const updatedAt = new Date().toISOString();  

      // 5️⃣ تحديث current_token في قاعدة البيانات
      const { data: updateData, error: updateError } = await supabaseAnon
        .from('profiles')
        .update({ current_token: null, updated_at: updatedAt })
        .eq('email', email)
        .select()
        .single();
    
      if (updateError) {
        return res.status(400).json({ error: updateError.message });
      }

      if (!updateData) {
        return res.status(404).json({ error: 'User not found' });
      }
    
      res.json({ message: 'تم تسجيل الخروج من جميع الأجهزة', ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
    

  router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    // 1️⃣ تسجيل الدخول عبر Supabase
    const { data: loginData, error: loginError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });

    
    if (loginError) return res.status(400).json({ error: loginError.message });
    const authenticatedClient = getAuthenticatedSupabaseClient(loginData.session.access_token);
    // 2️⃣ جلب بيانات البروفايل (مع current_token للتحقق)

    const { data: profile, error } = await authenticatedClient
      .from('profiles')
      .select('*')
      .eq('id', loginData.user.id)
      .single();
      
    if (error) {
    //   loggerSupa('login.Error', error.message, '', loginData.user.id);
      return res.status(400).json({ error: error.message });
    }

    // 3️⃣ تحقق إذا كان هناك جلسة سابقة (token صالح) – منع تسجيل دخول متعدد
    if (profile.current_token) {
      try {
        jwt.verify(profile.current_token, process.env.JWT_SECRET);
        return res.status(403).json({ error: 'User is already logged in on another device.' });
      } catch {
        // Token منتهي الصلاحية → نسمح بإنشاء واحد جديد
      }
    }

    // 4️⃣ إنشاء token جديد
    const token = jwt.sign(
      { 
        id: loginData.user.id, 
        email, 
        isAdmin: profile.is_admin 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );


// ... (After step 4: token creation)
const updatedAt = new Date().toISOString();  

  await supabaseAnon
    .from('profiles')
    .update({ current_token: token, updated_at: updatedAt })
    .eq('id', loginData.user.id);

  // Note: You don't need to await the data from the update call if you already have the profile data from step 2

  // ⭐️ NEW RESPONSE: Return the necessary client-side data ⭐️
  res.json({ 
      message: 'Login successful', 
      token: token, 
      email: loginData.user.email, // Explicitly pass email
      isAdmin: profile.is_admin, // Use the isAdmin value from the fetched profile
      profile: profile // Pass the full profile object fetched in step 2
  });
  } catch (err) {
    // loggerSupa('Login.Error', err.message, '');
    res.status(500).json({ error: err.message });
  }
  });

  router.post('/logout', async (req, res) => {
    try {
      const { email, token } = req.body;
      const userId = jwt.decode(token)?.id;

      if (!email || !token) {
        // logger.error("Email and token are required");
        // loggerSupa('Logout.Error', 'Email and token are required', '', userId);
        return res.status(400).json({ error: 'Email and token are required' });
      }

      const tokenEmail = jwt.decode(token)?.email;
      if (tokenEmail !== email) {
        // logger.error("Email does not match token");
        // loggerSupa('Logout.Error', 'Email does not match token', '', userId);
        return res.status(401).json({ error: 'Email does not match token' });
      }

      const [signOutResult, updateResult] = await Promise.all([
        supabaseAnon.auth.signOut(),
        supabaseAnon.from('profiles').update({
          current_token: null,
          updated_at: new Date().toISOString()
        }).eq('id', userId)
      ]);

      if (signOutResult.error) {
        // logger.error(signOutResult.error.message);
        // loggerSupa('Logout.Error', signOutResult.error.message, '', userId);
        return res.status(400).json({ error: signOutResult.error.message });
      }

    //   try {
    //     await fsP.rm(uploadingDir, { recursive: true, force: true });
    //     // logger.info("Uploads folder removed successfully.");
    //     // loggerSupa('UploadedSTL.Info', 'Uploads folder removed successfully.', '', userId);
    //   } catch (err) {
    //     console
    //     // logger.error("Error removing uploads folder:", err);
    //     // loggerSupa('UploadedSTL.Error', `Error removing uploads folder: ${err}`, '', userId);
    //   }

    //   logger.info('Logout successful');
    //   loggerSupa('Logout.Info', 'Logout successful', '', userId);
      res.json({ message: 'Logout successful' });

    } catch (err) {
    //   logger.error(err.message);
    //   loggerSupa('Logout.Error', err.message, '', userId);
      res.status(500).json({ error: err.message });
    }
  });


  export default router;

import * as React from 'react';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import TextField from '@mui/material/TextField';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import VideoCameraFrontIcon from '@mui/icons-material/VideoCameraFront';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { AuthContext } from '../contexts/AuthContext';
import { Snackbar } from '@mui/material';



const defaultTheme = createTheme({
    palette: {
        primary: { main: '#D97500' },
        secondary: { main: '#16233b' },
    },
    shape: { borderRadius: 10 },
});

export default function Authentication() {

    

    const [username, setUsername] = React.useState();
    const [password, setPassword] = React.useState();
    const [name, setName] = React.useState();
    const [error, setError] = React.useState();
    const [message, setMessage] = React.useState();


    const [formState, setFormState] = React.useState(0);

    const [open, setOpen] = React.useState(false)


    const { handleRegister, handleLogin } = React.useContext(AuthContext);

    let handleAuth = async () => {
        try {
            if (formState === 0) {
                await handleLogin(username, password)
            }
            if (formState === 1) {
                let result = await handleRegister(name, username, password);
                setUsername("");
                setMessage(result);
                setOpen(true);
                setError("")
                setFormState(0)
                setPassword("")
            }
        } catch (err) {

            console.log(err);
            let message = (err.response.data.message);
            setError(message);
        }
    }


    return (
        <ThemeProvider theme={defaultTheme}>
            <Grid container component="main" sx={{ height: '100vh' }}>
                <CssBaseline />
                <Grid
                    item
                    xs={false}
                    sm={4}
                    md={7}
                    sx={{
                        background: 'radial-gradient(circle at 25% 20%, #1f3252 0%, #0e1526 65%)',
                        display: { xs: 'none', sm: 'flex' },
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'flex-start',
                        color: '#fff',
                        px: { sm: 6, md: 10 },
                        position: 'relative',
                        overflow: 'hidden',
                    }}
                >
                    <VideoCameraFrontIcon sx={{ fontSize: 42, color: '#FF9839', mb: 3 }} />
                    <Box sx={{ fontSize: { sm: '2.1rem', md: '2.6rem' }, fontWeight: 700, lineHeight: 1.25, mb: 2, maxWidth: 480 }}>
                        Meetings that feel as good as the classroom.
                    </Box>
                    <Box sx={{ fontSize: '1rem', color: 'rgba(255,255,255,0.7)', maxWidth: 420, lineHeight: 1.6 }}>
                        Sign in to start or join a call, and pick up right where your last meeting left off.
                    </Box>
                </Grid>
                <Grid item xs={12} sm={8} md={5} component={Paper} elevation={0} square sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Box
                        sx={{
                            width: '100%',
                            maxWidth: 380,
                            px: 4,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                        }}
                    >
                        <Avatar sx={{ m: 1, bgcolor: 'primary.main', width: 48, height: 48 }}>
                            <LockOutlinedIcon />
                        </Avatar>

                        <Box sx={{ fontSize: '1.4rem', fontWeight: 700, color: '#16233b', mb: 3 }}>
                            {formState === 0 ? "Welcome back" : "Create your account"}
                        </Box>

                        <Box
                            sx={{
                                display: 'flex',
                                width: '100%',
                                background: '#f3f3f3',
                                borderRadius: '10px',
                                p: '4px',
                                mb: 1,
                            }}
                        >
                            <Button
                                fullWidth
                                disableElevation
                                variant={formState === 0 ? "contained" : "text"}
                                sx={{
                                    borderRadius: '8px',
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    color: formState === 0 ? '#fff' : '#555',
                                }}
                                onClick={() => { setFormState(0) }}>
                                Sign In
                            </Button>
                            <Button
                                fullWidth
                                disableElevation
                                variant={formState === 1 ? "contained" : "text"}
                                sx={{
                                    borderRadius: '8px',
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    color: formState === 1 ? '#fff' : '#555',
                                }}
                                onClick={() => { setFormState(1) }}>
                                Sign Up
                            </Button>
                        </Box>

                        <Box component="form" noValidate sx={{ mt: 1, width: '100%' }}>
                            {formState === 1 ? <TextField
                                margin="normal"
                                required
                                fullWidth
                                id="name"
                                label="Full Name"
                                name="name"
                                value={name}
                                autoFocus
                                onChange={(e) => setName(e.target.value)}
                            /> : <></>}

                            <TextField
                                margin="normal"
                                required
                                fullWidth
                                id="username"
                                label="Username"
                                name="username"
                                value={username}
                                autoFocus={formState === 0}
                                onChange={(e) => setUsername(e.target.value)}

                            />
                            <TextField
                                margin="normal"
                                required
                                fullWidth
                                name="password"
                                label="Password"
                                value={password}
                                type="password"
                                onChange={(e) => setPassword(e.target.value)}

                                id="password"
                            />

                            {error ? <p style={{ color: "#d32f2f", fontSize: "0.85rem", marginTop: "8px" }}>{error}</p> : null}

                            <Button
                                type="button"
                                fullWidth
                                disableElevation
                                variant="contained"
                                sx={{ mt: 3, mb: 2, py: 1.3, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.95rem' }}
                                onClick={handleAuth}
                            >
                                {formState === 0 ? "Log in" : "Create account"}
                            </Button>

                        </Box>
                    </Box>
                </Grid>
            </Grid>

            <Snackbar

                open={open}
                autoHideDuration={4000}
                message={message}
            />

        </ThemeProvider>
    );
}
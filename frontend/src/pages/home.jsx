import React, { useContext, useState } from 'react'
import withAuth from '../utils/withAuth'
import { useNavigate } from 'react-router-dom'
import "../App.css";
import { Button, IconButton, TextField } from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import { AuthContext } from '../contexts/AuthContext';

function HomeComponent() {


    let navigate = useNavigate();
    const [meetingCode, setMeetingCode] = useState("");


    const {addToUserHistory} = useContext(AuthContext);
    let handleJoinVideoCall = async () => {
        if (!meetingCode.trim()) {
            return;
        }
        await addToUserHistory(meetingCode)
        navigate(`/${meetingCode}`)
    }

    return (
        <>

            <div className="navBar">

                <div className="navBrand">
                    <h2>Converza</h2>
                </div>

                <div className="navActions">
                    <div className="navHistoryLink" onClick={() => navigate("/history")}>
                        <IconButton size="small" className="navHistoryIcon">
                            <RestoreIcon fontSize="small" />
                        </IconButton>
                        <p>History</p>
                    </div>

                    <Button
                        className="navLogoutBtn"
                        variant="outlined"
                        onClick={() => {
                            localStorage.removeItem("token")
                            navigate("/auth")
                        }}>
                        Logout
                    </Button>
                </div>


            </div>


            <div className="meetContainer">
                <div className="leftPanel">
                    <div>
                        <p className="heroEyebrow">Welcome back</p>
                        <h1>Providing quality video calls, just like quality education</h1>
                        <p className="heroSubtitle">Enter a meeting code to jump into an existing call, or start a new one from your history.</p>

                        <div className="joinCard">

                            <TextField
                                className="meetingCodeField"
                                onChange={e => setMeetingCode(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleJoinVideoCall(); }}
                                id="outlined-basic"
                                label="Meeting code"
                                placeholder="e.g. team-standup-42"
                                variant="outlined"
                                fullWidth
                            />
                            <Button
                                className="joinCallBtn"
                                onClick={handleJoinVideoCall}
                                variant='contained'
                                disabled={!meetingCode.trim()}
                            >
                                Join
                            </Button>

                        </div>
                    </div>
                </div>
                <div className='rightPanel'>
                    <img srcSet='/logo3.png' alt="" />
                </div>
            </div>
        </>
    )
}


export default withAuth(HomeComponent)
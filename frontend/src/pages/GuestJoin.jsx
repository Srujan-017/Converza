import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, TextField } from '@mui/material'
import "../App.css"

export default function GuestJoin() {
    const navigate = useNavigate();
    const [guestName, setGuestName] = useState('');
    const [meetingId, setMeetingId] = useState('');
    const [nameError, setNameError] = useState('');
    const [meetingError, setMeetingError] = useState('');

    const handleJoin = () => {
        let valid = true;

        if (!guestName.trim()) {
            setNameError('Please enter your display name');
            valid = false;
        } else {
            setNameError('');
        }

        if (!meetingId.trim()) {
            setMeetingError('Please enter a meeting ID');
            valid = false;
        } else {
            setMeetingError('');
        }

        if (!valid) return;

        const normalizedId = meetingId.trim();
        sessionStorage.setItem('guestName', guestName.trim());
        navigate(`/${normalizedId}`);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleJoin();
    };

    return (
        <div className='landingPageContainer'>
            <nav>
                <div className='navHeader'>
                    <h2>Converza</h2>
                </div>
                <div className='navlist'>
                    <p onClick={() => navigate("/auth")}>Register</p>
                    <div onClick={() => navigate("/auth")} role='button'>
                        <p>Login</p>
                    </div>
                </div>
            </nav>

            <div className="guestJoinOuter">
                <div className="guestJoinCard">
                    <p className="guestJoinEyebrow">No account needed</p>
                    <h2 className="guestJoinTitle">Join as Guest</h2>
                    <p className="guestJoinSubtitle">
                        Enter your display name and the meeting ID to jump straight into the call.
                    </p>

                    <TextField
                        label="Display Name"
                        value={guestName}
                        onChange={e => setGuestName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        error={!!nameError}
                        helperText={nameError}
                        variant="outlined"
                        fullWidth
                        className="guestField"
                        autoFocus
                    />

                    <TextField
                        label="Meeting ID"
                        value={meetingId}
                        onChange={e => setMeetingId(e.target.value)}
                        onKeyDown={handleKeyDown}
                        error={!!meetingError}
                        helperText={meetingError}
                        variant="outlined"
                        fullWidth
                        className="guestField"
                        placeholder="e.g. team-standup-42"
                    />

                    <Button
                        variant="contained"
                        onClick={handleJoin}
                        fullWidth
                        className="guestJoinBtn"
                        disabled={!guestName.trim() || !meetingId.trim()}
                    >
                        Join Meeting
                    </Button>

                    <p
                        className="guestBackLink"
                        onClick={() => navigate("/")}
                    >
                        ← Back to home
                    </p>
                </div>
            </div>
        </div>
    );
}

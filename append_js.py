with open('static/app.js', 'a', encoding='utf-8') as f:
    f.write('''\n
// ---- ADVANCED AUDIO FEEDBACK INIT (AGENT 5) ----
document.addEventListener('DOMContentLoaded', () => {
    const btnRecord = document.getElementById('btn-record-feedback');
    const recordingIndicator = document.getElementById('recording-indicator');
    const feedbackTextarea = document.getElementById('sirs_feedback_text');
    
    if (btnRecord && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        
        let isRecording = false;
        
        btnRecord.addEventListener('click', () => {
            if (!isRecording) {
                recognition.start();
                isRecording = true;
                btnRecord.classList.add('recording');
                btnRecord.innerHTML = '🛑 <span class="mic-text">Stop Dictation</span>';
                recordingIndicator.classList.remove('hidden');
                
                // Clear placeholder text if it's the first time
                if (!feedbackTextarea.value) {
                    feedbackTextarea.value = '';
                }
            } else {
                recognition.stop();
                isRecording = false;
                btnRecord.classList.remove('recording');
                btnRecord.innerHTML = '🎤 <span class="mic-text">Voice Dictation</span>';
                recordingIndicator.classList.add('hidden');
            }
        });
        
        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            // Append final transcript to textarea
            if (finalTranscript) {
                feedbackTextarea.value += (feedbackTextarea.value ? ' ' : '') + finalTranscript;
            }
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error', event.error);
            isRecording = false;
            btnRecord.classList.remove('recording');
            btnRecord.innerHTML = '🎤 <span class="mic-text">Voice Dictation</span>';
            recordingIndicator.classList.add('hidden');
            alert('Audio recognition error: ' + event.error + '. Make sure microphone permissions are granted.');
        };
    } else if (btnRecord) {
        // Browser doesn't support Speech API
        btnRecord.addEventListener('click', () => {
            alert('Your browser does not support the Web Speech API required for voice dictation. Please use Chrome or Edge.');
        });
    }
});
''')

from firebase_admin import credentials, firestore, initialize_app
import sys

try:
    cred = credentials.Certificate("firebase-credentials.json")
    initialize_app(cred)
    db = firestore.client()
    users = db.collection('users').stream()
    
    print("Firestore Users:")
    for user in users:
        print(f"{user.id} => {user.to_dict()}")
except Exception as e:
    print(f"Error: {e}")

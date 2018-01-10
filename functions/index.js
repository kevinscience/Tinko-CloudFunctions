
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
const GeoFire = require('geofire');
const geoFire = new GeoFire(admin.database().ref("Meets"));
var firestoreDb = admin.firestore();
var Promise = require("bluebird");

// userFacebookId equals facebookId 


exports.createNearbyMeetsToRTDB = functions.firestore.document('Meets/{meetId}').onCreate(event => {
    var newDoc = event.data.data();
    const theMeetId = event.params.meetId;
    var allowPeopleNearby = newDoc.allowPeopleNearby;
    if(allowPeopleNearby){
        var coordinate = newDoc.place.coordinate;
        //console.log(coordinate);
        var lat = coordinate.latitude;
        var lon = coordinate.longitude;
        return geoFire.set(theMeetId, [lat, lon]).then(function() {
            console.log(theMeetId + " has been added to GeoFire");
          }, function(error) {
            console.log("Error: " + error);
          });
    }
    return 0;
});

exports.deleteNearbyMeetsOfRTDB = functions.firestore.document('Meets/{meetId}').onDelete(event => {
    var newDoc = event.data.previous.data();
    const theMeetId = event.params.meetId;
    var allowPeopleNearby = newDoc.allowPeopleNearby;
    if(allowPeopleNearby){
        return geoFire.remove(theMeetId).then(function() {
            console.log(theMeetId + "key has been removed from GeoFire");
          }, function(error) {
            console.log("Error: " + error);
          });
    }
    return 0;
});


exports.removeExpiredMeets = functions.https.onRequest((req, res) => {
    return firestoreDb.collection('Meets').get()
    .then((snapshot) => {
        snapshot.forEach((doc) => {
            var meet = doc.data();
            var meetId = doc.id;
            var startTime = new Date(meet.startTime);
            var timeNow = new Date();
            var isExpired = startTime < timeNow;
            //console.log(doc.id, '=>', doc.data(), ' startTime: ', startTime, 'timeNow: ', timeNow, ' result: ', compare);
            if(isExpired){
                meet.status = false;
                firestoreDb.collection('ExpiredMeets').doc(meetId).set(meet);
                firestoreDb.collection('Meets').doc(meetId).delete();
            }
        });
        res.status(200).send('ok');
    })
    .catch((err) => {
        console.log('Error getting documents', err);
        res.status(500).send('error');
    });
});


exports.participateMeet = functions.https.onRequest((req,res) => {
    console.log('get in participateMeet');
    const userFacebookId = String(req.query.userFacebookId);
    console.log('userFacebookId: ' + userFacebookId);
    const meetId = String(req.query.meetId);
    console.log('meetId: ' + meetId);
    var meetRef = firestoreDb.collection('Meets').doc(meetId);
    return meetRef.get().then(doc => {
        if (!doc.exists) {
            console.log('No such document!');
            res.status(500).send('error');
        } else {
            //console.log('Document data:', doc.data());
            var meet = doc.data();
            var participatedUsersListDoc = meet.participatedUsersList;
            var creatorFacebookId = meet.creator;
            var timeDic = participatedUsersListDoc[creatorFacebookId];
            participatedUsersListDoc[userFacebookId] = timeDic;
            meetRef.update({participatedUsersList: participatedUsersListDoc});
            res.status(200).send('ok');
        }
    })
    .catch(err => {
        console.log('Error getting document', err);
        res.status(500).send('error');
    });
    
});


exports.leaveMeet = functions.https.onRequest((req,res) => {
    const userFacebookId = String(req.query.userFacebookId);
    console.log('userFacebookId: ' + userFacebookId);
    const meetId = String(req.query.meetId);
    console.log('meetId: ' + meetId);
    var meetRef = firestoreDb.collection('Meets').doc(meetId);
    return meetRef.get().then(doc => {
        if (!doc.exists) {
            console.log('No such document!');
            res.status(500).send('error');
        } else {
            //console.log('Document data:', doc.data());
            var meet = doc.data();
            var participatedUsersListDoc = meet.participatedUsersList;
            var creatorFacebookId = meet.creator;
            if(creatorFacebookId == userFacebookId){
                res.status(500).send('Tinko Creator cannot leave');
            } else {
                delete participatedUsersListDoc[userFacebookId];
                meetRef.update({participatedUsersList: participatedUsersListDoc});
                res.status(200).send('ok');
            }
        }
    })
    .catch(err => {
        console.log('Error getting document', err);
        res.status(500).send('error');
    });
    
});


exports.initializeNewUser = functions.https.onRequest((req,res) => {
    const facebookId = req.body.id;
    const name = req.body.name;
    const email = req.body.email;
    const uid = req.body.uid;
    var location;
    if (req.body.location === undefined){
        location = "";
    } else {
        location = req.body.location;
    }
    var gender;
    if(req.body.gender === undefined){
        gender = "";
    } else {
        gender = req.body.gender;
    }
    //console.log('facebookId', facebookId);

    var userRef = firestoreDb.collection('Users').doc(facebookId);
    return userRef.get()
        .then(doc => {
            if (doc.exists) {
                //console.log('Document data exist:', doc.data());
                res.status(200).send('ok');
             } else { //user does not exist
                //console.log('No such document!');
                var userData = {
                    facebookId : facebookId,
                    username: name,
                    email: email,
                    uid: uid,
                    photoURL: "https://graph.facebook.com/" + facebookId + "/picture?type=normal",
                    gender: gender,
                    location: location
                };
                return userRef.set(userData).then(ref => {
                    //console.log('Added document with ID: ', ref.id);
                    var friendsList = req.body.friends.data;
                    //console.log('friendsList: ', friendsList);
                    //friendsList:  [ { id: [ '1503367089694364', '107771053169905' ],name: [ 'Xue Donghua', 'Kevin Schrute' ] } ]
                    var friendsIdList = friendsList[0].id;
                    //console.log('friendsIdList: ', friendsIdList);
                    //FOR LOOP for Friends adding operation
                    Promise.map(friendsIdList, function (friendFacebookId){
                        initializeFriendShip(friendFacebookId, facebookId, userData);
                    }).then(()=>{
                        res.status(200).send('ok');
                    });
                }).catch(err => {
                    console.log('Error getting documents', err);
                });
                
            }
        })
        .catch(err => {
            console.log('Error getting document', err);
            res.status(500).send('test error');
        });
});

function initializeFriendShip(friendFacebookId,facebookId,userData){
    //console.log('friendFacebookId: ', friendFacebookId);
    var userRef = firestoreDb.collection('Users').doc(facebookId);
    var friendDocRef = firestoreDb.collection('Users').doc(friendFacebookId);
    return friendDocRef.get().then(doc => {
        if(doc.exists){
            var friendDocData = doc.data();
            //my ref add friend data
            const pr1 = userRef.collection('Friends_List').doc(friendFacebookId).set(friendDocData).catch(err => {
                console.log('Error getting documents', err);
            });
            //friend ref add my data
            const pr2 = friendDocRef.collection('Friends_List').doc(facebookId).set(userData).catch(err => {
                console.log('Error getting documents', err);
            });
            //add user to friends meet if allFriends = true
            var meetsRef = firestoreDb.collection('Meets');
            var meetsQueryRef = meetsRef.where('creator', '==', friendFacebookId);
            const pr3 = meetsQueryRef.get().then(snapshot => {
                snapshot.forEach(doc => {
                    //console.log(doc.id, '=>', doc.data());
                    //modify meet selectedFriendsList
                    var meet = doc.data();
                    var allFriends = meet.allFriends;
                    if(allFriends){
                        var timeDoc = meet.participatedUsersList[friendFacebookId];
                        var selectedFriendsDoc = meet.selectedFriendsList;
                        selectedFriendsDoc[facebookId] = timeDoc;
                        return meetsRef.doc(doc.id).update({selectedFriendsList:selectedFriendsDoc}).catch(err => {
                            console.log('Error updating documents', err);
                        });
                    }
                });
            }).catch(err => {
                console.log('Error getting documents', err);
            });
            return Promise.all([pr1,pr2,pr3]);
        } 
    });
}

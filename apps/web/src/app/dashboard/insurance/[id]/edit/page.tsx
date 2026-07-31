"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

import {
  PageHeader,
  Field,
  useToast,
} from "@/components/ui";

import {
  InsuranceClaim,
} from "@/lib/models";

import {
  ShieldCheck,
} from "lucide-react";


export default function EditInsurancePage() {


  const router = useRouter();

  const params = useParams();

  const id = params.id as string;


  const { notify } = useToast();



  const [loading,setLoading] =
    useState(true);


  const [saving,setSaving] =
    useState(false);




  const [claim,setClaim] =
    useState<InsuranceClaim | null>(null);





  useEffect(()=>{


    async function load(){


      const snap =
        await getDoc(
          doc(
            db,
            "insuranceClaims",
            id
          )
        );



      if(!snap.exists()){


        notify(
          "Insurance claim not found",
          "error"
        );


        router.push(
          "/dashboard/insurance"
        );


        return;

      }



      setClaim({

        id:snap.id,

        ...snap.data(),

      } as InsuranceClaim);



      setLoading(false);


    }



    load();


  },[id,router,notify]);









  async function save(
    form:FormData
  ){


    if(!claim)
      return;



    try{


      setSaving(true);



      await updateDoc(

        doc(
          db,
          "insuranceClaims",
          id
        ),

        {


          companyName:
            String(
              form.get("companyName") || ""
            ),



          policyNumber:
            String(
              form.get("policyNumber") || ""
            ),



          claimNumber:
            String(
              form.get("claimNumber") || ""
            ),




          claimAmountMinor:
            Number(
              form.get("claimAmountMinor")
            ),




          receivedAmountMinor:
            Number(
              form.get("receivedAmountMinor")
            ),




          status:
            String(
              form.get("status")
            ),




          notes:
            String(
              form.get("notes") || ""
            ),



        }

      );





      notify(
        "Insurance claim updated"
      );



      router.push(
        "/dashboard/insurance"
      );



    }

    catch(error){


      console.error(
        error
      );


      notify(
        "Could not update insurance claim",
        "error"
      );


    }

    finally{


      setSaving(false);


    }


  }








  if(
    loading ||
    !claim
  )

    return (

      <p className="p-6">
        Loading insurance form...
      </p>

    );









  return (

    <div className="mx-auto max-w-3xl">


      <PageHeader

        eyebrow="Finance"

        title="Edit Insurance Claim"

        icon={ShieldCheck}

      />






      <div className="card p-6">


        <form

          action={save}

          className="space-y-4"

        >






          <Field

            label="Insurance Company"

            required

          >

            <input

              name="companyName"

              className="input-luxe"

              defaultValue={
                claim.companyName
              }

              required

            />

          </Field>








          <Field

            label="Policy Number"

          >

            <input

              name="policyNumber"

              className="input-luxe"

              defaultValue={
                claim.policyNumber ?? ""
              }

            />

          </Field>








          <Field

            label="Claim Number"

          >

            <input

              name="claimNumber"

              className="input-luxe"

              defaultValue={
                claim.claimNumber ?? ""
              }

            />

          </Field>








          <Field

            label="Claim Amount (Minor)"

          >

            <input

              name="claimAmountMinor"

              type="number"

              className="input-luxe"

              defaultValue={
                claim.claimAmountMinor
              }

            />

          </Field>








          <Field

            label="Received Amount (Minor)"

          >

            <input

              name="receivedAmountMinor"

              type="number"

              className="input-luxe"

              defaultValue={
                claim.receivedAmountMinor
              }

            />

          </Field>








          <Field

            label="Status"

          >


            <select

              name="status"

              className="input-luxe"

              defaultValue={
                claim.status
              }

            >

              <option value="pending">
                Pending
              </option>


              <option value="approved">
                Approved
              </option>


              <option value="received">
                Received
              </option>


              <option value="rejected">
                Rejected
              </option>


            </select>


          </Field>









          <Field

            label="Notes"

          >

            <textarea

              name="notes"

              className="input-luxe"

              rows={4}

              defaultValue={
                claim.notes ?? ""
              }

            />


          </Field>









          <button

            type="submit"

            disabled={saving}

            className="btn-primary"

          >

            {
              saving
              ?
              "Saving..."
              :
              "Update Insurance Claim"
            }


          </button>






        </form>



      </div>



    </div>

  );


}